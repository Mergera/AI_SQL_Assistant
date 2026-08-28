# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest (`main`) | ✅ |
| older branches | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public issue.**

Report it privately by contacting the maintainer:

- **GitHub:** [@invo-coder19](https://github.com/invo-coder19)
- **Subject:** `[SECURITY] AI SQL Assistant – <brief description>`

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

You can expect an acknowledgement within **48 hours** and a fix or mitigation plan within **7 days**.

## Security Best Practices for Users

- Never commit your `.env` file or expose your `GEMINI_API_KEY` in public repositories.
- Use `.gitignore` to exclude `.env` (already configured in this repo).
- Rotate your API key immediately if you suspect it has been leaked.

## Disclosure Policy

Once a fix is released, vulnerabilities will be disclosed publicly via a GitHub Security Advisory.
