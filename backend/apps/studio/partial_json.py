"""Best-effort parsing of a JSON object that is still being streamed by an LLM."""

import json
import re

_DANGLING_KEY = re.compile(r'([,{])\s*"(?:[^"\\]|\\.)*"\s*:?\s*$')
_PARTIAL_LITERAL = re.compile(r"(?<=[:\[,])\s*(?:t|tr|tru|f|fa|fal|fals|n|nu|nul|-)$")
_TRAILING_COMMA = re.compile(r",\s*$")


def parse_partial(text):
    start = text.find("{")
    if start == -1:
        return None
    stack, in_str, esc = [], False, False
    end = len(text)
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if stack:
                stack.pop()
            if not stack:
                end = i + 1
                break
    buf = text[start:end]
    if in_str:
        if esc:
            buf = buf[:-1]
        buf = re.sub(r"\\u[0-9a-fA-F]{0,3}$", "", buf) + '"'
    closers = "".join("}" if c == "{" else "]" for c in reversed(stack))

    for fix in (None, _PARTIAL_LITERAL, _TRAILING_COMMA, _DANGLING_KEY):
        if fix is _DANGLING_KEY:
            buf = fix.sub(lambda m: "{" if m.group(1) == "{" else "", buf)
        elif fix is not None:
            buf = fix.sub("", buf)
        try:
            value = json.loads(buf + closers)
        except json.JSONDecodeError:
            continue
        return value if isinstance(value, dict) else None
    return None
