# Restructure DeskSOS project
$root = "C:\Projects\DESKSOS"
$backend = "$root\backend"
$frontend = "$root\frontend"

Write-Host "Starting DeskSOS restructuring..."

# Rename folders
Rename-Item "$root\DeskSOS-Enterprise---IT-Operations-Platform" $backend
Rename-Item "$root\client" $frontend

# Move server folder inside backend if needed
if (Test-Path "$root\server") {
    Move-Item "$root\server" "$backend\server" -Force
}

Write-Host "✅ Restructure complete."
