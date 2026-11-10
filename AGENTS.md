# Project Guidelines

## Project direction

This project is a learning experience. The Groq chat and shared-text systems are
technical demos for checking that the underlying integrations work; they are
not commitments to keep those implementations. They may be replaced as the
project evolves.

The eventual goal is a discipline and motivation site. Treat current features
and technology choices as experiments in service of that direction, not as
permanent product requirements.

## Cost

Keep absolutely everything free to use and operate. The project has stayed
free so far, and that should continue; the only planned exception is the
eventual domain name.

## Development approach

- Prefer clear, maintainable code over keeping the project in as few files as
  possible. Creating multiple files is encouraged when it improves separation
  of concerns or makes the code easier to understand.
- Keep experimentation open: the client may use other languages compiled to
  WebAssembly, and the server may be implemented in other languages.
- Make changes approachable for a learner. Explain important decisions and
  non-obvious tradeoffs, and avoid unnecessary complexity.
