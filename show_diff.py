import difflib
import os

with open('src/points.js.orig', 'r') as f:
    orig = f.readlines()
with open('src/points.js', 'r') as f:
    current = f.readlines()

diff = difflib.unified_diff(orig, current, fromfile='src/points.js.orig', tofile='src/points.js')
print(''.join(diff))
