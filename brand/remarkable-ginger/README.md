# The Remarkable Ginger: brand kit for social posts

> **Daily post task: check [PLANNED.md](PLANNED.md) first.** If today has a planned post there, use it exactly.

Brand: **The Remarkable Ginger**, a 4% alcoholic ginger beer brewed by Double Cone Brewing in Kingston, on Lake Wakatipu, NZ. It launches summer 2026, with cans expected around mid-December 2026.
Handle: @remarkableginger (Instagram, Facebook, TikTok).
Look: bright, playful and illustrated. The scene shows purple mountains (the Remarkables), a turquoise lake and a colourful lupin foreground.
Fonts: Luckiest Guy for headlines, Nunito for body text.

## Files

| File | What it is |
|---|---|
| `scene_clean.png` / `.svg` | Main scene artwork (wide). `gen_clean.py` regenerates it. |
| `lupins_left.png` / `.svg` | Lupin cluster overlay. `teaser/lup.svg` is a wide lupin strip. |
| `remarkable-ginger-profile.png` | Round logo, 1080×1080. |
| `remarkable-ginger-cover.png` | Facebook cover. |
| `label_trim.png` | Flat 330 ml can label artwork. |
| `Remarkable-Ginger-330ml-label-ARTWORK.pdf` | Print artwork. |
| `teaser/t.html` | HTML animation used for the first teaser reel. |
| `teaser/music.wav` | Original track (numpy synth, 104 BPM). It is copyright-free and can be reused. |
| `fonts/` | Luckiest Guy (OFL) and Nunito (OFL). |

## How a post is made and published

1. Render the post with HTML, Playwright Chrome and these fonts:
   - Image: a 1080×1350 JPEG, under 8 MB.
   - Reel: a 1080×1920 MP4 at 30 fps, 6–20 s, with original music only.
2. Host it by adding the file to `public/social/` in this repo, then branch → PR → squash-merge. It is then live at `https://breworx.vercel.app/social/<file>`. Wait about 1–2 minutes for the Vercel deploy before posting.
3. Post through the Windsor.ai MCP:
   - Instagram (`instagram`), account `17841437224134336`:
     - `create_image_post`
     - `create_video_post` with `share_to_feed: true`
     - `create_carousel_post`
   - Facebook Page (`facebook_organic`), account `1495428600317273`:
     - `create_photo_post`
     - `create_reel`
