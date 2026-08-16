# Android release and Google Play signing

## Unsigned build

Gradle automatically enforces the committed `gradle/verification-metadata.xml` checksums for plugins and dependencies. Review dependency updates and regenerate metadata deliberately; never bypass verification in release CI.

With no signing environment variables, this command creates an unsigned, R8-minified AAB:

```powershell
./gradlew.bat clean :app:testDebugUnitTest :app:lintRelease :app:bundleRelease
```

Output: `app/build/outputs/bundle/release/app-release.aab`

Verify its current state:

```powershell
jarsigner -verify -verbose -certs app/build/outputs/bundle/release/app-release.aab
$signatureEntries = jar tf app/build/outputs/bundle/release/app-release.aab | Select-String -Pattern '^META-INF/[^/]+\.(RSA|DSA|EC)$'
if (-not $signatureEntries) { Write-Output 'UNSIGNED: no JAR signature entry' }
```

An unsigned bundle reports `jar is unsigned` and has no matching signature entry. Do not rely on the process exit code alone: `jarsigner` can return zero for an unsigned archive. Do not upload it.

## One-time Play App Signing setup

Google Play App Signing uses a protected app-signing key held by Google and an upload key controlled by NUC7 Studios. Perform these steps on a protected release workstation or signing service, not in the repository.

1. Enroll the Play Console app `com.nuc7.threeaikgpt` in Play App Signing.
2. Create an upload key interactively at a path outside the checkout (example only):

   ```powershell
   keytool -genkeypair -v -keystore C:\secure\3aikgpt-upload.jks -alias 3aikgpt-upload -keyalg RSA -keysize 3072 -validity 9125
   ```

   Let `keytool` prompt for passwords. Never put passwords, the keystore, or a base64-encoded key in source control, build output, chat, logs, or a command-line argument.

3. Export the public upload certificate and register it in Play Console if requested:

   ```powershell
   keytool -export -rfc -keystore C:\secure\3aikgpt-upload.jks -alias 3aikgpt-upload -file C:\secure\3aikgpt-upload-certificate.pem
   ```

Back up the upload keystore and recovery information in the organization’s approved secrets system. The certificate is public; the keystore/passwords are not.

## Exact upload-key build

The Gradle configuration enables release signing only when all four environment variables are present:

- `THREEAIK_UPLOAD_KEYSTORE` — absolute keystore path;
- `THREEAIK_UPLOAD_KEY_ALIAS` — upload alias;
- `THREEAIK_UPLOAD_STORE_PASSWORD` — keystore password;
- `THREEAIK_UPLOAD_KEY_PASSWORD` — key password.

Set those variables through the protected CI secret manager or an ephemeral release shell, then run:

```powershell
./gradlew.bat clean :app:testDebugUnitTest :app:lintRelease :app:bundleRelease
```

The output path is unchanged. Verify the signature and certificate before upload:

```powershell
jarsigner -verify -verbose -certs app/build/outputs/bundle/release/app-release.aab
$signatureEntries = jar tf app/build/outputs/bundle/release/app-release.aab | Select-String -Pattern '^META-INF/[^/]+\.(RSA|DSA|EC)$'
if (-not $signatureEntries) { throw 'Release AAB is unsigned' }
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
Get-FileHash app/build/outputs/bundle/release/app-release.aab -Algorithm SHA256
```

Compare the printed SHA-256 certificate fingerprint with the Play Console upload certificate. A successful `jarsigner` verification alone is not enough if the wrong key signed the bundle.

## Upload

1. Complete every item in [PLAY_STORE.md](PLAY_STORE.md), including the live privacy-policy URL and Data safety review.
2. Create the intended internal/closed/production release in Play Console.
3. Upload the verified signed AAB.
4. Confirm Play shows version `3.0.0` and code `30000`, package `com.nuc7.threeaikgpt`, target API 36, and the expected signing certificate.
5. Review automated pre-launch, policy, accessibility, security, device-catalog, and integrity results before rollout.
6. Save the source revision, toolchain versions, AAB SHA-256, upload-certificate SHA-256, test/lint reports, and Play release ID in the release record.

Never sign with the debug key. Never ask Play to create a second app for the invalid `com.nuc7.3aikGPT` ID. Future releases must increment `versionCode` while keeping the production application ID unchanged.
