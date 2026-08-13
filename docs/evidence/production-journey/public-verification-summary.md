# Sanitized public and accessibility verification summary

The final production public matrix runs at 1440×900, 1024×768, 768×1024, and 390×844. It covers the marketing site, product guide, developer reference, sign-in, public CFP directory, public CFP, public program explorer, evaluator entry, all five widgets, and machine-readable outputs.

- Production public browser gate: 77 passed, 3 non-mobile navigation cases skipped by viewport applicability, 0 failures.
- Production help browser/crawler gate: 132 passed, 0 failed.
- Automated accessibility: zero serious and zero critical findings on covered routes; keyboard names, touch targets, reflow at 320 CSS pixels, zoom to 200%, reduced motion, dialog behavior, and horizontal overflow are asserted.
- The help crawler reported zero broken internal links, unexpected redirects, 404 pages, or incomplete canonical/title/description metadata.
- All five widget types returned ProgramLoom Summit 2027 with at least 12 sessions and 15 speakers, complete session metadata, alphabetized speaker surnames, biographies and headshot fields, and accessible direct/embed layouts.
- JSON, XML, ICS, HTML, iframe, and JavaScript embed contracts passed.
- Itinerary add, reload persistence, removal, and ICS export passed at all four production viewport projects.
- Exact evaluator persona notes and their normal authorization/anonymous destinations are protected by a production regression.

