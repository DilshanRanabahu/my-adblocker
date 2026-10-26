# My AdBlocker

A simple Manifest V3 ad blocker for Microsoft Edge (also works in Chrome), built on EasyList, EasyPrivacy and Peter Lowe's list.

## Features

- Network blocking with `declarativeNetRequest` (about 86,000 ad/tracker domains plus path rules)
- Cosmetic filtering: generic and site-specific element hiding
- Hides the empty boxes left behind by blocked images, frames and embeds
- Popup with an on/off switch, a per-site allow list, and a blocked-request counter
- Filter lists update automatically once a day, or on demand from the popup

## Install (unpacked)

1. Open `edge://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this folder

## Rebuilding the bundled rules

Download the latest lists into this folder:

- https://easylist.to/easylist/easylist.txt
- https://easylist.to/easylist/easyprivacy.txt
- https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext (save as `peterlowe.txt`)

Then run:

```bash
node build-rules.js   # writes rules.json, cosmetic.css, cosmetic-specific.json
node make-icons.js    # regenerates icons/ (only needed if you change the icon)
```

Reload the extension in `edge://extensions` afterwards.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest |
| `background.js` | Service worker: on/off and allow list, badge counter, list updates |
| `content.js` | Requests site-specific CSS and hides blocked elements |
| `popup.html`, `popup.js` | Toolbar popup |
| `filters.js` | Filter list parser shared by the build script and the service worker |
| `build-rules.js` | Converts the `.txt` lists into the bundled rule files |
| `make-icons.js` | Generates the PNG icons |

## Filter list licenses

- EasyList and EasyPrivacy: dual licensed under GPLv3 and CC BY-SA 3.0, https://easylist.to/pages/licence.html
- Peter Lowe's list: https://pgl.yoyo.org/adservers/ (see the site for terms of use)
