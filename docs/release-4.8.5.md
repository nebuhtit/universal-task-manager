# Universal Task Manager 4.8.5

- Shares WebDAV connection addresses as a full folder URL followed by @workspace-code. No passwords or credentials are copied.
- Sign-in and settings extract the embedded code automatically; separate URL/code entry remains compatible. Shared folder paths are used exactly once, including trailing-slash and root-folder cases.
- Settings provide a localized Copy action and reject foreign workspace codes before connection checks or saving. Current data cannot be uploaded under a different workspace identity by pasting a shared address.
- Equivalent server/folder representations preserve the sync checkpoint instead of resetting it solely because a full path moved from the separate folder field into the URL.
- Sanitized diagnostics record shared-address parsing and copying without the address or code. Help documents the format.
