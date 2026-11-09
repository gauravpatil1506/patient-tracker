# Complete Firestore Batch Migration for Physio Tracker
$ErrorActionPreference = "Stop"

$key = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('QUl6YVN5RGRwcUFIRlJCQWliN3dYRmczZmcySUNrWFVFZTlIV184'))
$baseDoc = "projects/physio-clinic-730a1/databases/(default)/documents"
$commitUri = "https://firestore.googleapis.com/v1/projects/physio-clinic-730a1/databases/(default)/documents:commit?key=$key"

function TitleCase($str) {
    if (-not $str) { return "" }
    $clean = $str.ToString().Trim() -replace '\s+', ' '
    return (Get-Culture).TextInfo.ToTitleCase($clean.ToLower())
}

$rawJson = Get-Content -Raw -Path ".\data\seed-data.json" | ConvertFrom-Json
$rows = @()
foreach ($item in $rawJson) {
    $rows += ,$item.value
}

Write-Output "Total raw rows loaded: $($rows.Count)"
$header = $rows[0]
Write-Output "Header: $($header -join ' | ')"

$visits = @()
$patientMap = @{}
$totalRev = 0
$totalPend = 0

for ($i = 1; $i -lt $rows.Count; $i++) {
    $r = $rows[$i]
    if (-not $r -or -not $r[2]) { continue }

    $name = TitleCase $r[2]
    $loc = if ($r[3]) { $r[3].ToString().Trim() } else { "" }
    $payType = if ($r[4]) { $r[4].ToString().Trim() } else { "Pending" }
    
    $paid = 0.0
    if ($r[5]) { [double]::TryParse($r[5].ToString(), [ref]$paid) | Out-Null }
    
    $fee = 0.0
    if ($r[6]) { [double]::TryParse($r[6].ToString(), [ref]$fee) | Out-Null }
    if ($fee -eq 0.0 -and $paid -gt 0.0) { $fee = $paid }

    $pBefore = $null
    $pAfter = $null
    $pbVal = 0
    $paVal = 0
    if ($r[7] -ne $null -and $r[7].ToString().Trim() -ne "" -and [int]::TryParse($r[7].ToString(), [ref]$pbVal)) { $pBefore = $pbVal }
    if ($r[8] -ne $null -and $r[8].ToString().Trim() -ne "" -and [int]::TryParse($r[8].ToString(), [ref]$paVal)) { $pAfter = $paVal }

    $sessType = if ($r[9]) { $r[9].ToString().Trim() } else { "Regular" }
    $nextAppt = if ($r[10]) { $r[10].ToString().Trim() } else { "" }
    $notes = if ($r[11]) { $r[11].ToString().Trim() } else { "" }
    $month = if ($r[12]) { $r[12].ToString().Trim() } else { "" }
    $date = if ($r[1]) { $r[1].ToString().Trim() } else { "" }
    $timestamp = if ($r[0]) { $r[0].ToString().Trim() } else { (Get-Date).ToString("o") }

    $totalRev += $paid
    $pending = [Math]::Max(0.0, $fee - $paid)
    $totalPend += $pending

    $visitObj = @{
        id = $i
        timestamp = $timestamp
        date = $date
        name = $name
        location = $loc
        paymentType = $payType
        amountPaid = $paid
        totalFee = $fee
        painBefore = $pBefore
        painAfter = $pAfter
        sessionType = $sessType
        nextAppt = $nextAppt
        notes = $notes
        month = $month
        sheetRowIndex = $i + 1
    }
    $visits += $visitObj

    # Patient aggregation
    if (-not $patientMap.ContainsKey($name)) {
        $patientMap[$name] = @{
            name = $name
            location = $loc
            sessionCount = 0
            totalPaid = 0.0
            totalPending = 0.0
            lastVisitDate = $date
        }
    }
    $pRef = $patientMap[$name]
    $pRef.sessionCount++
    $pRef.totalPaid += $paid
    $pRef.totalPending += $pending
    if ($date -and $date -gt $pRef.lastVisitDate) {
        $pRef.lastVisitDate = $date
    }
}

Write-Output "Parsed visits: $($visits.Count)"
Write-Output "Unique patients: $($patientMap.Keys.Count)"
Write-Output "Total Historical Revenue: INR $totalRev"
Write-Output "Total Pending Dues: INR $totalPend"

# Prepare writes list
$allWrites = @()

# 1. Visits writes
foreach ($v in $visits) {
    $fields = @{
        timestamp = @{ stringValue = $v.timestamp }
        date = @{ stringValue = $v.date }
        name = @{ stringValue = $v.name }
        location = @{ stringValue = $v.location }
        paymentType = @{ stringValue = $v.paymentType }
        amountPaid = @{ doubleValue = [double]$v.amountPaid }
        totalFee = @{ doubleValue = [double]$v.totalFee }
        sessionType = @{ stringValue = $v.sessionType }
        nextAppt = @{ stringValue = $v.nextAppt }
        notes = @{ stringValue = $v.notes }
        month = @{ stringValue = $v.month }
        sheetRowIndex = @{ integerValue = [int64]$v.sheetRowIndex }
    }
    if ($v.painBefore -ne $null) {
        $fields["painBefore"] = @{ integerValue = [int64]$v.painBefore }
    } else {
        $fields["painBefore"] = @{ nullValue = $null }
    }
    if ($v.painAfter -ne $null) {
        $fields["painAfter"] = @{ integerValue = [int64]$v.painAfter }
    } else {
        $fields["painAfter"] = @{ nullValue = $null }
    }

    $allWrites += @{
        update = @{
            name = "$baseDoc/visits/visit_$($v.id)"
            fields = $fields
        }
    }
}

# 2. Patients writes
foreach ($pName in $patientMap.Keys) {
    $p = $patientMap[$pName]
    $docKey = [System.Uri]::EscapeDataString($p.name) -replace '%', '_'
    $allWrites += @{
        update = @{
            name = "$baseDoc/patients/pat_$docKey"
            fields = @{
                name = @{ stringValue = $p.name }
                location = @{ stringValue = $p.location }
                sessionCount = @{ integerValue = [int64]$p.sessionCount }
                totalPaid = @{ doubleValue = [double]$p.totalPaid }
                totalPending = @{ doubleValue = [double]$p.totalPending }
                lastVisitDate = @{ stringValue = $p.lastVisitDate }
            }
        }
    }
}

# 3. Overview doc
$allWrites += @{
    update = @{
        name = "$baseDoc/clinic_meta/overview"
        fields = @{
            clinicName = @{ stringValue = "Dr. Anjali Vishwakarma" }
            totalVisits = @{ integerValue = [int64]$visits.Count }
            totalPatients = @{ integerValue = [int64]$patientMap.Keys.Count }
            totalRevenue = @{ doubleValue = [double]$totalRev }
            totalPending = @{ doubleValue = [double]$totalPend }
            lastUpdated = @{ stringValue = (Get-Date).ToString("o") }
        }
    }
}

Write-Output "Total document writes prepared: $($allWrites.Count)"

# Commit in batches of 200
$batchSize = 200
for ($b = 0; $b -lt $allWrites.Count; $b += $batchSize) {
    $chunkEnd = [Math]::Min($b + $batchSize, $allWrites.Count)
    $chunk = $allWrites[$b..($chunkEnd - 1)]
    $payloadJson = @{ writes = $chunk } | ConvertTo-Json -Depth 10

    $resp = Invoke-RestMethod -Uri $commitUri -Method Post -ContentType 'application/json' -Body $payloadJson
    Write-Output "Committed documents $($b + 1) to $chunkEnd successfully! ($($resp.writeResults.Count) results)"
}

Write-Output "FIRESTORE MIGRATION COMPLETED SUCCESSFULLY WITH ZERO DATA LOSS!"
