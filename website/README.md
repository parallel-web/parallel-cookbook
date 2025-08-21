# TODO:

- Add `blog:true` to cookbook. If this is the case, main link opens blog at `GET /{slug}`
- `GET /{slug}` would render `blog.html` which is populated with https://uithub.com/{owner}/{repo}/tree/main/BLOG.md prerenderd into HTML

If this is desirable, work on it. For simplicity, we can also first just use `README.md` as the main place where blog is found.

# Idea: Remix

- Keep `SPEC.md` in sync with the actual code
- ✅ Remix button should just link to https://remix.forgithub.com/owner/repo/tree/main/path/to/recipe and can just redirect to LMPIFY
