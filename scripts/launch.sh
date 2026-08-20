#!/bin/sh
# Launch the shaderBoi local server (if not already running) and open it in the browser.
export PATH="/opt/homebrew/bin:$PATH"
URL="http://localhost:8402/"
if ! curl -s -o /dev/null --max-time 2 "$URL"; then
  nohup python3 /Users/user/Documents/shaderdeck/serve.py 8402 > /tmp/shaderboi-serve.log 2>&1 &
  i=0
  while [ $i -lt 40 ]; do
    curl -s -o /dev/null --max-time 1 "$URL" && break
    sleep 0.5
    i=$((i+1))
  done
fi
open "$URL"
