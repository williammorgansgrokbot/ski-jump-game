#!/bin/bash
# full jump at each viewport; previews/{tag}_*.png
cd /workspace/ski-jump-game
python3 tools/qa.py 844 390 iphone_844x390 full 2>&1 | grep -E "ERRORS|result|pageerror|console:"
python3 tools/qa.py 932 430 iphone_932x430 full 2>&1 | grep -E "ERRORS|result|pageerror|console:"
python3 tools/qa.py 1180 820 ipad_1180x820 full 2>&1 | grep -E "ERRORS|result|pageerror|console:"
python3 tools/qa.py 1366 1024 ipadpro_1366x1024 full 2>&1 | grep -E "ERRORS|result|pageerror|console:"
