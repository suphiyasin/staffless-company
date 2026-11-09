import type { ChatRequest, ChatResponse, Provider } from "./types.ts";

/**
 * Demo provider: no API key needed. It fakes every role with canned but
 * coherent answers and produces a small working website, so anyone can clone
 * the repo and watch the whole company flow in seconds.
 */

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    });
  });

const rand = (a: number, b: number) => a + Math.random() * (b - a);

type H = {
  stage?: string;
  lang?: string;
  department?: string;
  roleId?: string;
  brief?: string;
  title?: string;
  taskTitle?: string;
  revisions?: number;
  availableKeys?: string[];
  round?: number;
  latestRequest?: string;
  design?: { name?: string; fontsHref?: string };
  requests?: { id: string; top: string; label: string; role: string }[];
  taskKind?: string;
  qaCycle?: number;
};

function titleFrom(brief: string, en: boolean): string {
  const quoted = brief.match(/["“'']([^"”'']{3,40})["”'']/);
  if (quoted) return quoted[1].trim();
  const words = brief
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  const base = words.map((w) => w[0].toLocaleUpperCase("tr") + w.slice(1)).join(" ");
  return base || (en ? "New Website" : "Yeni Web Sitesi");
}

function respond(h: H): unknown {
  const en = h.lang === "en";
  const t = (tr: string, eng: string) => (en ? eng : tr);
  const title = h.title || titleFrom(h.brief ?? "", en);
  const keys = new Set(h.availableKeys ?? []);
  const deps = (...k: string[]) => k.filter((x) => keys.has(x));

  switch (h.stage) {
    case "ceo": {
      const revision = (h.round ?? 1) > 1;
      return {
        title,
        summary: revision
          ? t(
              `Müşteri mevcut "${title}" projesinde şu değişikliği istiyor: ${h.latestRequest}. Yazılım ekibi değişikliği uygulayacak, kalite ekibi kontrol edecek.`,
              `The client wants this change to "${title}": ${h.latestRequest}. Engineering applies it, QA verifies.`,
            )
          : t(
              `"${title}" için tek sayfalık, modern ve mobil uyumlu bir tanıtım sitesi hazırlanacak. Müşteri isteği: ${h.brief}. Tasarım ekibi renk/tipografi ve logo, içerik ekibi metinler, yazılım ekibi HTML/CSS/JS kodu üretecek; kalite ekibi her şeyi kontrol edecek.`,
              `A modern, responsive one-page site for "${title}". Client request: ${h.brief}. Design: palette, type and logo. Content: copy. Engineering: HTML/CSS/JS. QA verifies everything.`,
            ),
        reply: revision
          ? t("Talebinizi aldık, hemen ilgili ekiplere iletiyorum.", "Got it, passing this to the relevant teams right away.")
          : t(
              `Merhaba! "${title}" projenizi aldık. Tasarım, içerik, yazılım ve kalite ekiplerimizi görevlendiriyorum. İlerlemeyi buradan canlı takip edebilirsiniz.`,
              `Hello! We've got your "${title}" project. I'm assigning design, content, engineering and QA. You can follow progress live here.`,
            ),
        departments: revision
          ? [
              { department: "software", goal: t("İstenen değişikliği uygula", "Apply the requested change") },
              { department: "qa", goal: t("Değişikliği test et", "Test the change") },
            ]
          : [
              { department: "design", goal: t("Tasarım sistemi ve logo", "Design system and logo") },
              { department: "content", goal: t("Sayfa metinleri", "Page copy") },
              { department: "software", goal: t("Çalışan web sitesi", "Working website") },
              { department: "qa", goal: t("Test ve kalite kontrol", "Testing and QA") },
            ],
      };
    }

    case "manager": {
      const r = h.round ?? 1;
      const k = (d: string, n: number) => (r > 1 ? `${d}-r${r}-${n}` : `${d}-${n}`);
      const plans: Record<string, unknown[]> = {
        design: [
          { key: k("design", 1), title: t("Tasarım sistemi", "Design system"), description: t("Renk paleti, tipografi ve bileşenleri docs/tasarim.md dosyasında tanımla.", "Define palette, type and components in docs/design.md."), role: "ui-designer", dependsOn: [] },
          { key: k("design", 2), title: t("Logo tasarımı", "Logo design"), description: t("assets/logo.svg olarak sade bir logo çiz.", "Draw a simple logo as assets/logo.svg."), role: "graphic-designer", dependsOn: [] },
        ],
        content: [
          { key: k("content", 1), title: t("Site metinleri", "Site copy"), description: t("Başlık, slogan, özellikler ve iletişim metinlerini docs/icerik.md dosyasına yaz.", "Write headline, tagline, features and contact copy in docs/content.md."), role: "copywriter", dependsOn: [] },
        ],
        software: [
          { key: k("software", 1), title: r > 1 ? t("Değişikliği uygula", "Apply change") : t("Ana sayfayı kodla", "Build the landing page"), description: t("index.html, styles.css ve script.js dosyalarını üret.", "Produce index.html, styles.css and script.js."), role: "frontend-developer", dependsOn: deps("design-1", "design-2", "content-1") },
          ...(r > 1 ? [] : [{ key: k("software", 2), title: t("Rezervasyon API'si", "Reservation API"), description: t("server/server.js içinde iletişim/rezervasyon uç noktası.", "A contact/reservation endpoint in server/server.js."), role: "backend-developer", dependsOn: [] }]),
        ],
        qa: [
          { key: k("qa", 1), title: t("Kalite kontrol", "Quality check"), description: t("Tüm dosyaları incele, docs/test-raporu.md yaz.", "Review all files and write docs/qa-report.md."), role: "qa-tester", dependsOn: [...deps(k("software", 1)), ...(r > 1 ? [] : [k("software", 2)])] },
        ],
      };
      return {
        reply: t("Tamam, işi aldım. Ekibime görevleri dağıtıyorum.", "Okay, on it. Splitting the work across my team."),
        tasks: plans[h.department ?? ""] ?? [],
      };
    }

    case "hire":
      return {
        decisions: (h.requests ?? []).map((r) => ({
          requestId: r.id,
          choice: r.top,
          message: t(
            `Teşekkürler YZK, ${r.label} ${r.role} işleri için uygun. Onaylıyorum, işe alalım.`,
            `Thanks, AIR. ${r.label} fits the ${r.role} work. Approved, let's hire.`,
          ),
        })),
      };

    case "worker":
      return workerOutput(h, title, en);

    case "qa-review": {
      // First test cycle finds one bug so the demo shows QA → Engineering → re-test.
      const fail = (h.qaCycle ?? 0) === 0;
      return {
        approved: true,
        feedback: "",
        productPassed: !fail,
        issues: fail
          ? [t("index.html: iletişim formu gönderildikten sonra ekran okuyuculara bilgi verilmiyor (aria-live eksik).", "index.html: the contact form's success message is not announced to screen readers (missing aria-live).")]
          : [],
        message: fail
          ? t("Rapor sağlam. Bir hata var, yazılıma geri gönderiyorum.", "Solid report. One bug found, sending it back to engineering.")
          : t("Yeniden test temiz, yayına hazır.", "Re-test is clean, ready to ship."),
      };
    }

    case "design-review":
      return {
        approved: true,
        issues: [],
        message: t("Ekran görüntülerine baktım: masaüstünde ve telefonda tasarıma uygun.", "Checked the screenshots: it follows the design on desktop and phone."),
      };

    case "review": {
      // Ask for one revision on the first frontend pass so the demo shows the loop.
      const wantRevision = h.roleId === "frontend-developer" && (h.revisions ?? 0) === 0 && !h.taskKind;
      return wantRevision
        ? {
            approved: false,
            feedback: t("Mobil görünümde menü taşıyor; küçük ekranlar için düzenle.", "Nav overflows on mobile; fix it for small screens."),
            message: t("İyi başlangıç ama bir düzeltme lazım.", "Good start, one fix needed."),
          }
        : { approved: true, feedback: "", message: t("Eline sağlık, onaylandı.", "Great work, approved.") };
    }

    case "delivery":
      return {
        message: t(
          `"${title}" projeniz hazır. Tasarım, içerik ve yazılım tamamlandı; QA bulduğu tek sorunu düzelttirip onayladı. "Preview" ile siteyi açabilir, "Download" ile tüm dosyaları alabilirsiniz. Değişiklik isterseniz yazmanız yeterli.`,
          `Your "${title}" project is ready. Design, content and engineering are done, and QA signed off after one fix. Open it with "Preview" or grab every file with "Download". Want a change? Just tell me.`,
        ),
      };
  }
  return {};
}

function workerOutput(h: H, title: string, en: boolean) {
  const t = (tr: string, eng: string) => (en ? eng : tr);
  const done = (
    summary: string,
    files: { path: string; content: string }[],
    edits: { path: string; find: string; replace: string }[] = [],
  ) => ({
    summary,
    message: t("Görev tamamlandı, kontrolünüze sunuyorum.", "Done, ready for your review."),
    files,
    edits,
  });

  switch (h.roleId) {
    case "ui-designer":
      if (!h.design) return done(t("Projenin tasarım sistemini kütüphane formatında yazdım (DESIGN.md + tokens.css).", "Wrote the project's design system in the library format (DESIGN.md + tokens.css)."), ownDesign(title));
      return done(t("Tasarım sistemini hazırladım.", "Prepared the design system."), [
        {
          path: en ? "docs/design.md" : "docs/tasarim.md",
          content: `# ${title}: ${t("Tasarım Sistemi", "Design System")}\n\n## ${t("Renkler", "Colors")}\n- Primary: #6d5efc\n- Accent: #22d3ee\n- Ink: #0f172a\n- Paper: #f8fafc\n\n## ${t("Tipografi", "Typography")}\n- ${t("Başlıklar", "Headings")}: Inter 800\n- ${t("Metin", "Body")}: Inter 400, 17px / 1.6\n\n## ${t("Bileşenler", "Components")}\n- ${t("Butonlar: 12px köşe, gölge", "Buttons: 12px radius, soft shadow")}\n- ${t("Kartlar: 20px köşe, ince kenarlık", "Cards: 20px radius, hairline border")}\n`,
        },
      ]);
    case "graphic-designer":
      return done(t("Logoyu SVG olarak çizdim.", "Drew the logo as SVG."), [
        {
          path: "assets/logo.svg",
          content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d5efc"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><text x="32" y="42" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="800" fill="#fff" text-anchor="middle">${escapeXml(title[0] ?? "A")}</text></svg>\n`,
        },
      ]);
    case "copywriter":
      return done(t("Site metinlerini yazdım.", "Wrote the site copy."), [
        {
          path: en ? "docs/content.md" : "docs/icerik.md",
          content: `# ${title}\n\n**${t("Slogan", "Tagline")}:** ${t("Fikirden ürüne, tek adımda.", "From idea to product, in one step.")}\n\n## ${t("Özellikler", "Features")}\n1. ${t("Hızlı: dakikalar içinde hazır", "Fast: ready in minutes")}\n2. ${t("Güvenilir: her adım kontrol edilir", "Reliable: every step is reviewed")}\n3. ${t("Esnek: ihtiyacınıza göre büyür", "Flexible: grows with you")}\n`,
        },
      ]);
    case "seo-specialist":
      return done(t("SEO önerilerini hazırladım.", "Prepared SEO notes."), [
        { path: "docs/seo.md", content: `# SEO\n\n- title: ${title}\n- description: ${title}\n` },
      ]);
    case "frontend-developer":
      // Fixes and revisions send small find/replace edits instead of whole files.
      if (h.taskKind === "fix") {
        return done(t("QA bulgusunu düzelttim: form mesajına aria-live eklendi.", "Fixed the QA finding: added aria-live to the form message."), [], [
          { path: "index.html", find: '<p class="ok" hidden>', replace: '<p class="ok" hidden aria-live="polite">' },
        ]);
      }
      if ((h.revisions ?? 0) > 0) {
        return done(t("Mobil menü sorununu düzelttim.", "Fixed the mobile nav issue."), [], [
          { path: "styles.css", find: FOOTER_CSS, replace: `${FOOTER_CSS}
${MOBILE_CSS}` },
        ]);
      }
      return done(
        h.design
          ? t(`Ana sayfayı "${h.design.name}" tasarımının değişkenleriyle kodladım.`, `Built the landing page on the "${h.design.name}" design tokens.`)
          : t("Ana sayfayı HTML/CSS/JS olarak kodladım.", "Built the landing page in HTML/CSS/JS."),
        landingPage(title, en, false, h.design),
      );
    case "backend-developer":
      return done(t("Basit bir iletişim API'si yazdım.", "Wrote a small contact API."), [
        {
          path: "server/server.js",
          content: `import http from "node:http";\n\nhttp.createServer((req, res) => {\n  if (req.method === "POST" && req.url === "/api/contact") {\n    res.writeHead(200, { "content-type": "application/json" });\n    return res.end(JSON.stringify({ ok: true }));\n  }\n  res.writeHead(404).end();\n}).listen(3000);\n`,
        },
      ]);
    case "qa-tester":
      return done(
        h.taskKind === "retest"
          ? t("Düzeltmeyi doğruladım, başka sorun yok.", "Verified the fix; nothing else broke.")
          : t("Bir erişilebilirlik sorunu buldum: form başarı mesajında aria-live yok.", "Found one accessibility issue: the form's success message has no aria-live."),
        [
        {
          path: en ? "docs/qa-report.md" : "docs/test-raporu.md",
          content: `# ${t("Test Raporu", "QA Report")}\n\n| ${t("Kontrol", "Check")} | ${t("Sonuç", "Result")} |\n|---|---|\n| HTML ${t("geçerliliği", "validity")} | ✅ |\n| ${t("Mobil uyum", "Responsive")} | ✅ |\n| ${t("Erişilebilirlik (alt, label)", "Accessibility (alt, label)")} | ✅ |\n| ${t("Kırık bağlantı", "Broken links")} | ✅ ${t("yok", "none")} |\n`,
        },
      ]);
  }
  return done("OK", []);
}

const MOBILE_CSS = `@media (max-width: 640px) {
  .menu { display:block; }
  .nav nav { display:none; width:100%; flex-direction:column; padding-top:12px; }
  .nav nav.open { display:flex; }
  .nav nav a { margin:8px 0; }
}`;
const FOOTER_CSS = "footer { text-align:center; padding:24px; color:var(--color-muted, #64748b); }";

/** A small but complete design in the library format, as the design team would write it. */
function ownDesign(title: string) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return [
    {
      path: "design/DESIGN.md",
      content: `---
id: ${id}-style
name: ${title} Style
description: Bright and confident: violet primary, cyan highlights, generous rounded cards.
tags: [bright, rounded, friendly]
best_for: [product sites, startups, landing pages]
fonts: [Inter:400,600,800]
---
# ${title} Style

## Principles
- One clear message per section, one primary action per screen.
- Violet is for actions; cyan only highlights.
- Generous white space and rounded shapes keep it friendly.

## Layout
Centred hero, three-column feature grid, contact band. Max width 1120px, 96px between sections.

## Typography
Inter. Headlines 48–64px weight 800, tight tracking. Body 17px/1.6.

## Color
Light paper background, white surfaces, ink text, violet primary, cyan accent.

## Components
- **Buttons:** 12px radius, violet fill, white label.
- **Cards:** white, hairline border, 20px radius, soft shadow.
- **Navigation:** sticky, translucent, logo left.
- **Forms:** rounded inputs, violet focus ring.

## Imagery & icons
Simple emoji or line icons; abstract gradients.

## Motion
150–200ms fades and lifts.

## Do
- Keep copy short
- Use the tokens for every colour

## Don't
- More than one accent
- Hard-coded colours
`,
    },
    {
      path: "design/tokens.css",
      content: `/* ${title} Style: design tokens. */
:root {
  --color-bg: #f8fafc;
  --color-surface: #ffffff;
  --color-text: #0f172a;
  --color-muted: #64748b;
  --color-border: #e2e8f0;
  --color-primary: #6d5efc;
  --color-primary-contrast: #ffffff;
  --color-accent: #22d3ee;

  --font-heading: 'Inter', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --heading-weight: 800;
  --heading-transform: none;
  --heading-tracking: -0.02em;

  --radius: 12px;
  --radius-lg: 20px;
  --border-width: 1px;
  --shadow: 0 8px 24px rgba(15,23,42,.08);
  --space: 8px;
  --max-width: 1120px;
}
`,
    },
  ];
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function landingPage(title: string, en: boolean, fixed: boolean, design?: { name?: string; fontsHref?: string }) {
  const t = (tr: string, eng: string) => (en ? eng : tr);
  const safe = escapeXml(title);
  return [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="${en ? "en" : "tr"}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe}</title>
  <link rel="icon" href="assets/logo.svg" />
${design ? `  ${design.fontsHref ? `<link rel="stylesheet" href="${design.fontsHref}" />\n  ` : ""}<link rel="stylesheet" href="design/tokens.css" />\n` : ""}  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="nav">
    <a class="brand" href="#"><img src="assets/logo.svg" alt="${safe} logo" width="36" height="36" /> ${safe}</a>
    <button class="menu" aria-label="${t("Menüyü aç", "Open menu")}" aria-expanded="false">☰</button>
    <nav><a href="#features">${t("Özellikler", "Features")}</a><a href="#contact">${t("İletişim", "Contact")}</a></nav>
  </header>
  <main>
    <section class="hero">
      <h1>${safe}</h1>
      <p>${t("Fikirden ürüne, tek adımda.", "From idea to product, in one step.")}</p>
      <a class="btn" href="#contact">${t("Hemen başla", "Get started")}</a>
    </section>
    <section id="features" class="grid">
      <article><h3>⚡ ${t("Hızlı", "Fast")}</h3><p>${t("Dakikalar içinde hazır.", "Ready in minutes.")}</p></article>
      <article><h3>🛡️ ${t("Güvenilir", "Reliable")}</h3><p>${t("Her adım kontrol edilir.", "Every step is reviewed.")}</p></article>
      <article><h3>🌱 ${t("Esnek", "Flexible")}</h3><p>${t("İhtiyacınıza göre büyür.", "Grows with you.")}</p></article>
    </section>
    <section id="contact" class="contact">
      <h2>${t("Bize ulaşın", "Contact us")}</h2>
      <form>
        <label>${t("E-posta", "Email")} <input type="email" required placeholder="you@example.com" /></label>
        <button class="btn" type="submit">${t("Gönder", "Send")}</button>
      </form>
      <p class="ok" hidden>${t("Teşekkürler! En kısa sürede dönüş yapacağız.", "Thanks! We'll get back to you soon.")}</p>
    </section>
  </main>
  <footer>© ${new Date().getFullYear()} ${safe}</footer>
  <script src="script.js"></script>
</body>
</html>
`,
    },
    {
      path: "styles.css",
      content: `:root { --primary:var(--color-primary, #6d5efc); --accent:var(--color-accent, #22d3ee); --ink:var(--color-text, #0f172a); --paper:var(--color-bg, #f8fafc); }
* { box-sizing: border-box; }
body { margin:0; font:17px/1.6 var(--font-body, Inter, system-ui, sans-serif); color:var(--ink); background:var(--paper); }
h1, h2, h3, .brand { font-family:var(--font-heading, inherit); text-transform:var(--heading-transform, none); letter-spacing:var(--heading-tracking, normal); }
.nav { display:flex; align-items:center; justify-content:space-between; padding:16px 24px; position:sticky; top:0; background:color-mix(in srgb, var(--paper) 85%, transparent); backdrop-filter:blur(8px); flex-wrap:wrap; border-bottom:var(--border-width, 0px) solid var(--color-border, transparent); }
.nav a { color:var(--ink); }
.brand { display:flex; gap:10px; align-items:center; font-weight:800; color:inherit; text-decoration:none; }
.nav nav a { margin-left:20px; color:inherit; text-decoration:none; }
.menu { display:none; background:none; border:0; font-size:24px; cursor:pointer; }
.hero { text-align:center; padding:96px 24px; background:linear-gradient(135deg,var(--primary),var(--accent)); color:#fff; }
.hero h1 { font-size:clamp(36px,7vw,64px); margin:0 0 8px; }
.btn { display:inline-block; padding:12px 22px; border-radius:var(--radius, 12px); background:var(--color-surface, #fff); color:var(--ink); font-weight:700; text-decoration:none; border:var(--border-width, 0px) solid var(--color-border, transparent); cursor:pointer; box-shadow:var(--shadow, 0 8px 24px #0002); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px; padding:64px 24px; max-width:1000px; margin:auto; }
.grid article { background:var(--color-surface, #fff); border:var(--border-width, 1px) solid var(--color-border, #e2e8f0); border-radius:var(--radius-lg, 20px); padding:24px; box-shadow:var(--shadow, none); }
.contact { text-align:center; padding:48px 24px 80px; }
.contact form { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
.contact input { padding:12px; border-radius:12px; border:1px solid #cbd5e1; margin-left:8px; }
.contact .btn { background:var(--primary); color:var(--color-primary-contrast, #fff); }
.contact input { background:var(--color-surface, #fff); color:var(--ink); border:var(--border-width, 1px) solid var(--color-border, #cbd5e1); border-radius:var(--radius, 12px); }
footer { text-align:center; padding:24px; color:var(--color-muted, #64748b); }
${
  fixed ? MOBILE_CSS : ""
}
`,
    },
    {
      path: "script.js",
      content: `const menu = document.querySelector(".menu");
const nav = document.querySelector(".nav nav");
menu?.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menu.setAttribute("aria-expanded", String(open));
});

document.querySelector(".contact form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  document.querySelector(".contact .ok").hidden = false;
  e.target.reset();
});
`,
    },
  ];
}

export const mockProvider: Provider = {
  id: "mock",
  label: "Demo (simulated AI)",
  configured: () => true,

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const h = (req.hint ?? {}) as H;
    await sleep(h.stage === "worker" ? rand(1800, 3500) : rand(700, 1500), req.signal);
    const text = JSON.stringify(respond(h));
    const inputChars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
    return { text, inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(text.length / 4) };
  },
};
