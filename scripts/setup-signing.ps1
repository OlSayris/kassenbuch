# Einmalig: Signaturschluessel fuer die Android-App erzeugen und als GitHub-Secrets hinterlegen.
# Ohne denselben Schluessel lassen sich spaeter keine Updates installieren (nur Neuinstallation = Datenverlust).
$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$repo    = 'OlSayris/kassenbuch'
$keytool = 'C:\Program Files\Java\jre1.8.0_241\bin\keytool.exe'
$target  = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Kassenbuch-Signatur'
$ks      = Join-Path $target 'kassenbuch-release.p12'

if (Test-Path $ks) { throw "Es gibt schon einen Schluessel: $ks - nicht ueberschreiben!" }

$s1 = Read-Host 'Neues Passwort fuer den Schluessel (mind. 8 Zeichen)' -AsSecureString
$s2 = Read-Host 'Passwort wiederholen' -AsSecureString
$pw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
$pw2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
if ($pw -ne $pw2) { throw 'Passwoerter stimmen nicht ueberein.' }
if ($pw.Length -lt 8) { throw 'Passwort zu kurz.' }

New-Item -ItemType Directory -Force $target | Out-Null
& $keytool -genkeypair -keystore $ks -storetype PKCS12 -storepass $pw -keypass $pw -alias kassenbuch `
  -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Kassenbuch, O=OlSayris'
if (-not (Test-Path $ks)) { throw 'Schluessel wurde nicht erzeugt.' }

[Convert]::ToBase64String([IO.File]::ReadAllBytes($ks)) | gh secret set ANDROID_KEYSTORE_BASE64 -R $repo
$pw | gh secret set ANDROID_KEYSTORE_PASSWORD -R $repo
gh secret list -R $repo

Write-Host ''
Write-Host "Fertig. Schluessel liegt in: $ks" -ForegroundColor Green
Write-Host 'Bitte Datei UND Passwort sicher aufbewahren (z. B. Passwort-Manager + Cloud-Backup der Datei).' -ForegroundColor Yellow
