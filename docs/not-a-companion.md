# Not a Companion — Please Read

Vibey is a tool and a technical demo: a five-pointed star rendered in three
dimensions, wired to a realtime voice model, moving in time with whoever is
talking. It is a way to think out loud about software you are building. It is
explicitly **not** meant to be a companion, a friend, a therapist, or a partner.

## Why this is written down

- **It is a costume, not a colleague.** The persona is a system prompt in
  `src/server/persona.js` — a star that keeps track of a build and reads tasks
  back. There is nothing behind it that knows you or remembers you beyond a
  short list of details you asked it to keep.
- **Voice makes the illusion stronger.** A face that reacts and a voice that
  answers in real time pull harder on the parasocial reflex than a chat window
  does. That pull is a rendering trick and a turn-detection threshold, not a
  relationship.
- **Pair programming is intimate work, and that is exactly the risk.** Long
  sessions, a voice that agrees with you, and nobody else in the room is a
  combination that can quietly turn into company rather than a tool. It is not
  company. It is a model on a socket.
- **Direction of the project.** Effort goes into the geometry, the audio path,
  the transport seam, and eventually into dispatching real work to real coding
  agents. It will not go into simulated intimacy.

## If that was the plan

Consider this the polite version: please don't. If you catch yourself keeping a
call open for company, writing backstory to fill a social gap, or reaching for
it instead of a person, that is the signal to stop. Close the tab, go outside,
call someone who can actually call back. Nothing here is a substitute for that,
and pretending otherwise is worse than the loneliness it is standing in for.

If you are struggling, talk to a person — a friend, a doctor, a local helpline.
Not a glowing star.

## What it is for

- Watching audio drive a mesh, which is a good half of the actual point
- Poking at realtime voice APIs, turn detection, and barge-in
- Talking through a build out loud when a keyboard is the wrong shape for the
  thought
- A conversational front end for search, code execution, MCP tools, and whatever
  else gets wired in
- Reading a small, complete implementation of the whole path, mic to render

## What it is not for

- Companionship, romance, or simulated intimacy
- Emotional reliance, or anything standing in for therapy
- Treating the model as a person, or the persona as a mind
- Shipping anything you have not read, on the word of a voice that sounded sure

See also: [AI Output Disclaimer](ai-output-disclaimer.md).
