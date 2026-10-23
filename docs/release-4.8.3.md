# Universal Task Manager 4.8.3

- WebDAV browser access tries direct first. Network/CORS failures can select the configured relay; HTTP access errors do not switch routes. Selected routes expire after five minutes, allowing direct access to be checked again.
- The first mutation uses a read-only direct probe if no route is known. A mutation with an unknown result is never replayed automatically through the relay. Its failure selects the relay for the next request; the normal lock/read/merge/conditional-write workflow remains responsible for retrying synchronization.
- Adds a self-contained Node.js 22+ local relay download and bilingual offline/LAN instructions on sign-in, Help and the settings guide. Downloads are precached with the PWA. Local relay maps the advertised DAV URL to a configured LAN upstream, preserving conditional writes and locks without WAN access. Loopback HTTP is allowed; serving other LAN devices requires HTTPS with a trusted certificate.
- Safe device diagnostics record direct probes and route fallback without addresses, credentials or file content. Local relay diagnostics are opt-in and contain only method, status and duration.
- Configured LAN/loopback connections can automatically retry even if browser online detection reports no internet; normal retry backoff remains active.
- Targeted transport, protocol and real loopback integration checks cover direct-first, safe fallback, no mutation replay and offline LAN mapping. Physical iPhone verification is still required.
