$ports = @(5000, 3001)

foreach ($port in $ports) {
    $result = netstat -ano | Select-String ":$port"
    if ($result) {
        $pid = ($result -split "\s+")[-1]
        Write-Host "⚠️ Port $port is in use by PID $pid — terminating..."
        taskkill /PID $pid /F
        Write-Host "✔️ Port $port freed."
    }
    else {
        Write-Host "✅ Port $port is free."
    }
}

