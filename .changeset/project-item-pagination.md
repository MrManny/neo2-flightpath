---
"neo2-flightpath": patch
---

The agent helpers now find GitHub project items past the first `gh project item-list` page when moving an issue's project status, and a missed status move while the project is readable prints a short note on stderr instead of failing silently.
