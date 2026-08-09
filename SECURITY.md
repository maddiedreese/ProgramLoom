# Security policy

ProgramLoom handles unpublished proposals, speaker details, travel logistics, and event files. Please do not disclose vulnerabilities publicly before a fix is available.

Report a vulnerability privately to `security@programloom.com` with reproduction steps, affected URLs, and impact. We will acknowledge reports within two business days and provide status updates until resolution.

Supported production releases receive security fixes. Secrets belong in Cloudflare secret bindings or local ignored environment files, never source control. Every data access path must enforce organization, event, and role scope on the server; hiding a control in the browser is not authorization.
