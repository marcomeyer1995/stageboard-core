# phone-check - pages at phone size, headless

```
node tools/phone-check/phone-check.mjs start                       # headless Chrome, DevTools port 9400
node tools/phone-check/phone-check.mjs open https://stageboard.local/
export CDP_VIEWPORT=390x844x3                                      # phone size + touch, set on every cdp.mjs call
node tools/cdp/cdp.mjs shot 9400 phone.png
node tools/cdp/cdp.mjs eval 9400 "innerWidth"                      # 390
node tools/phone-check/phone-check.mjs stop
```

Used for the phone GUI reviews: the Xiaomi phone blocks adb input, so its screens are checked
in a headless Chrome at its size instead. Headless Chrome keeps windows at least 500 px wide and
an emulation ends with its DevTools session, so the size travels with every call (`CDP_VIEWPORT`;
the Xiaomi 14T Pro was `375x834x3.25`). Load the page after setting it once, so its layout starts
at phone size. Sign in as a test member there (a profile without a
PIN); never type real credentials by script.

The Chrome profile is `out/profile` (git-ignored) - a separate, throwaway profile.
