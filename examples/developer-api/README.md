# ProgramLoom API example

This dependency-free Node.js example lists the events and sessions available to one ProgramLoom organization token. It never places the token in a URL or writes it to disk.

1. In ProgramLoom, open **Workspace settings → API tokens**.
2. Create a token with `read:events` and `read:sessions`. Keep **Hide PII** enabled and restrict it to the events this example needs.
3. Copy the one-time value into your shell, run the example, and then clear it:

```bash
PROGRAMLOOM_TOKEN='pl_live_…' node examples/developer-api/list-program.mjs
unset PROGRAMLOOM_TOKEN
```

Set `PROGRAMLOOM_API_URL` only when testing another deployment. The default is the production v1 endpoint.
