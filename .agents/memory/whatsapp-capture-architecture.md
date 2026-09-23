---
name: WhatsApp capture architecture
description: Durable boundary between the fixed WhatsApp capture entry and normal inbox handling.
---

The permanent WhatsApp capture link is identified by the exact prefilled phrase, while the sender phone is the session identity. Capture sessions use the existing deterministic intake engine internally; no public token or per-client link is exposed.

**Why:** A reusable permanent link must work for any number of contacts without turning ordinary WhatsApp messages into capture sessions or creating a second integration.

**How to apply:** Keep the exact trigger as the only new-entry gate, resume only an active sender-scoped session, make the facade photo terminal, and return to normal inbox routing after completion.