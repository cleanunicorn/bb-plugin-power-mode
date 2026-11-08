#!/usr/bin/env bash
# Trim, caption and encode the raw Power Mode capture into docs/media/power-mode-demo.{mp4,jpg}.
# Usage: docs/demo/encode.sh <raw.webm> <marks.json> [out-dir]
# marks.json is written by docs/demo/record.mjs (segment start offsets in seconds).
set -euo pipefail
RAW=${1:?raw .webm}; MARKS=${2:?marks.json}; OUT=${3:-docs/media}
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
m() { jq -r --arg k "$1" '.[$k]' "$MARKS"; }
START=$(echo "$(m 1-toggle) - 1.4" | bc -l)      # drop page-load lead-in
END=$(echo "$(m end) - 5.0" | bc -l)             # drop idle tail after the finale
rel() { echo "$(m "$1") - $START" | bc -l; }
T1=0; T2=$(rel 2-typing); T3=$(rel 3-settings); T4=$(rel 4-paste); T5=$(rel 5-agent); TE=$(echo "$END - $START" | bc -l)

TMP=$(mktemp -d)
cap() { # id text start end  (text goes through a file so ":" and "," need no filtergraph escaping)
  printf '%s' "$2" > "$TMP/cap$1.txt"
  printf "drawtext=fontfile=%s:textfile=%s:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.72:boxborderw=14:x=(w-text_w)/2+60:y=h-70:enable='between(t,%s,%s)'" "$FONT" "$TMP/cap$1.txt" "$3" "$4"
}
VF="fps=30,$(cap 1 '1 · Enable: click ⚡ in the sidebar footer (or Mod+Alt+P)' $T1 $T2),\
$(cap 2 '2 · Type: particles, shake, combo + WPM, Backspace shards' $T2 $T3),\
$(cap 3 '3 · Settings → Power Mode: switch theme, tune sliders' $T3 $T4),\
$(cap 4 '4 · Paste ~1,500 chars: tier 4 rocket barrage' $T4 $T5),\
$(cap 5 '5 · Agent Power Mode: sparks, word combo, TURN COMPLETE' $T5 $TE),format=yuv420p"

mkdir -p "$OUT"
ffmpeg -v error -y -ss "$START" -to "$END" -i "$RAW" -vf "$VF" -an -c:v libx264 -preset slow -crf 25 \
  -pix_fmt yuv420p -movflags +faststart -map_metadata -1 -metadata title= "$OUT/power-mode-demo.mp4"

# Poster: a mid-typing frame from the raw capture (combo counter + particles, no caption) with a play badge.
POSTER_T=$(echo "$(m 2-typing) + 9" | bc -l)
ffmpeg -v error -y -ss "$POSTER_T" -i "$RAW" -frames:v 1 \
  -vf "drawtext=fontfile=$FONT:text='▶':fontsize=110:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=40:x=(w-text_w)/2:y=(h-text_h)/2" \
  -q:v 3 -map_metadata -1 "$OUT/power-mode-demo.jpg"
ls -l "$OUT"/power-mode-demo.*
