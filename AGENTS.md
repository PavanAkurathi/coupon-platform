# Shared engineering rules

Read `docs/COORDINATION.md` and `../PRODUCT-BRIEF.md` before a new work packet.

- Founder hard rule: follow `docs/TRUST-CHARTER.md`. Never deceive shoppers or businesses, take another party's attribution, distort recommendations for commission or invent savings. These requirements take precedence over growth and revenue goals; they do not authorize new tracking or monetization behavior.

- This is one product. Codex and Claude Code use the same product requirements and Zod wire contracts in `packages/shared`.
- Work only in your assigned files. Request a contract change through a handoff instead of editing another owner's files.
- Do not alter existing user files, archives, `.env`, installed-browser profiles or credentials. Do not inspect secret files for context.
- Do not publish, deploy, contact merchants, send messages, install extensions or change production data without the user's applicable authorization. Local implementation and tests within the assigned packet are authorized.
- Amazon and 3–5 Shopify stores are required at launch. Demo support, guessed selectors and synthetic coupons do not count as live support. Never invent merchant agreements, verified coupon evidence or earnings.
- Never access cookies, insert affiliate tags, redirect tracking links, submit orders or interact with payment fields. Coupon attribution must be reviewed too; unknown attribution behavior must not enable automatic application.
- Keep the exact $1 rule: confirmed additional savings, earned commission of at least $1, protected prior attribution, once per order; zero otherwise. Never deduct the fee from shopper savings.
- Before handoff, run relevant tests and typechecks/build. State what passed, what was not run, and what remains uncertain. Keep docs concise.
- Record completed work and cross-owner requests in `docs/COORDINATION.md`; the coordinating agent owns final integration.
