# Universal Task Manager 4.8.2

- Adds a separately deployed HTTPS WebDAV relay for browser servers without CORS. The user's Keenetic address selects the deployed relay by default; an empty proxy field explicitly selects direct access. Other servers use direct access unless their own trusted relay is entered.
- Native iOS keeps its direct HTTPS transport. Proxy settings remain device-local; no workspace encryption password is transmitted to the relay.
- Relay forwarding preserves conditional requests, ETags, LOCK/UNLOCK and MOVE; upstreams and browser origins are allowlisted. Redirects are refused; request and response bodies are bounded to 20 MiB.
- Safe device diagnostics record proxy request milestones without endpoint addresses or credentials. Relay request/body logging is disabled.
- Live deployment verified with CORS preflight and an intentionally invalid login returning the upstream 401. Full synchronization of the user's encrypted workspace still requires a real-device trial.
