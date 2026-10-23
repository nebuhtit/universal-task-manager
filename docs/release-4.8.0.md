# Universal Task Manager 4.8.0

## WebDAV onboarding

- Uses the standard `UniversalSync` folder automatically when opening a workspace from WebDAV; a separate folder field is no longer required.
- Allows selecting a custom folder by appending its path to the WebDAV URL.
- Shows the current connection, download, password-validation, or local-save stage and explains common HTTP/authentication failures.
- Includes pre-workspace WebDAV attempts in the troubleshooting-log count and exports safe failure stage/code details.
- Keeps the workspace code because it identifies the encrypted workspace file; it is not an additional password.

## Verification

- Web app typecheck and production build passed locally.
- Physical iPhone behavior still needs confirmation after installing this build.
