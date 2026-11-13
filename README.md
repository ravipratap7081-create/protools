# ProTools — Free PDF & Image Tools

Free PDF and image tools that run entirely in your browser. No upload, no sign-up, no watermark — your files never leave your device.

**Live demo:** https://pdf-merge-split-free.vercel.app

Snapshot of the live site as of 13 Nov 2026.

## Tools

- Merge PDFs, split a PDF into pages, compress a PDF to a target size, extract pages
- Resize photos to exact sizes for exam and government forms — SSC photo 20–50 KB, SSC signature 10–20 KB, RRB NTPC signature 30–49 KB, passport photo 20 KB, and more
- General photo resize and PDF tools, plus step-by-step guides

## How it works

Static HTML with client-side JavaScript, hosted on Vercel. PDF work uses pdf-lib (bundled), zipped downloads use JSZip, styling is Tailwind CSS. It is a PWA, so it can be installed. Analytics run through Supabase behind a consent banner.

## Run it

No build step. Serve the folder with any static server, for example:

```
python3 -m http.server
```

then open http://localhost:8000

## Pro

Pro costs ₹149/month via Instamojo and raises the limits (25 MB per PDF, 20 MB per photo, vs 10 MB / 5 MB free), with priority support and no ads.

## Notes

- The analytics beacon (`tracking-beacon-v2.js`) and the login page are intentionally not in this repo — they embed the project's Supabase anon key.
- A separate 100% native Android app (v2.0) also exists.

Built by Ravi Pratap Singh (RPS World, Kanpur, India).
