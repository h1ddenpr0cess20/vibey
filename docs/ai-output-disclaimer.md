# AI Output Disclaimer and Conditions of Use

Effective date: 2026-07-30

This document sets out the limits of responsibility for Vibey ("the App"). It is
informational and not legal advice. It supplements, and does not replace, the
MIT License in this repository.

## 1) Purpose and scope

- Makes clear that everything the App says comes from a third-party AI service,
  not from the author.
- Places responsibility for use and consequences on the person running the App
  and on the model provider — not on the author.
- Sets conditions of use. If you disagree with them, do not run the App.

## 2) Definitions

- **"App"**: the Vibey client, its proxy, and the materials in this repository.
- **"Provider"**: xAI, whose realtime model the App dials, and any gateway or
  MCP server put in front of it.
- **"Outputs"**: anything the model generates or triggers — spoken audio,
  transcripts, text, or tool calls.
- **"Operator"**: whoever runs the App and supplies the `XAI_API_KEY`.
- **"You"**: any operator, user, or organisation running or distributing the
  App.

## 3) What the App actually is

- The App captures microphone audio, relays it to a xAI Grok speech-to-speech
  session, and renders what comes back as a five-pointed star.
- It does not create, host, train, or operate any model. It has no model of its
  own and no opinions of its own.
- The persona is a few paragraphs of system prompt in `src/server/persona.js`.
  It is a costume on someone else's model, not a mind. It orchestrates nothing
  on its own — it talks about work, and any tool that acts is one you enabled.
- The operator supplies the API key. It stays in the Node process; the page
  never holds a long-lived credential.
- Defects, errors, and harms attributable to model behaviour are the
  responsibility of the Provider and of whoever chooses to act on Outputs.

## 4) No responsibility for Outputs

- Outputs come from a third-party model the author did not build, does not
  control, and cannot correct.
- The author is not responsible for any content, action, decision, or
  consequence arising from Outputs, including Outputs shaped by the persona
  prompt shipped here.
- If you disagree with that allocation of responsibility, you are not permitted
  to run the App.

## 5) Voice-specific risks

Speech is not text, and some of the risk here does not exist in a chat window:

- **It is heard before it can be checked.** Outputs are spoken as they arrive.
  There is no draft to proofread, and an error is out loud in the room before
  anyone can catch it.
- **The microphone is live.** While a call is up, audio from the room is
  streamed to the Provider. That includes anyone else within earshot, whether or
  not they know the App is running.
- **Recording others.** Consent to record or transmit another person's voice is
  your responsibility, and in some jurisdictions it is a legal requirement
  rather than a courtesy. The App does not obtain it for you.
- **Hands-free is not attention-free.** The App is not for use while driving,
  operating machinery, or doing anything else where looking away from the task
  is unsafe.
- **Transcription is imperfect.** What the model hears is not always what was
  said, and the log stores the transcript rather than the audio.

## 6) No professional or emergency use

- Outputs are not a substitute for professional advice — medical, legal,
  financial, engineering, safety, or otherwise.
- Do not use the App for crisis response, life-support, dispatch, or any
  safety-critical purpose.
- Do not put it in the loop on production systems, deployments, or anything with
  irreversible effects. It is a way to talk about work, not an authority over
  it.
- If you or someone you know is in crisis, contact local emergency services or
  an appropriate hotline. Do not rely on this App, or any AI model, for crisis
  intervention.

## 7) Your responsibilities

- Use independent judgement. Verify anything that matters before acting on it.
- Comply with applicable law, and with the Provider's terms and usage policies.
- Do not say anything to the App you would not want transmitted to the Provider.
  Treat every call as it is: a live connection to someone else's server.
- Anything the App remembers between calls is text you or the model put there.
  Review it, and clear it when it is no longer wanted.
- You are solely responsible for what you say to the App, what you do with what
  it says back, and anything you publish from it.

## 8) Minors

- **Not child-directed.** The App is not designed for children and can produce
  content unsuitable for them. It dials a general-purpose model with no
  age-appropriate filtering of its own.
- **Supervision required.** A parent or legal guardian must provide direct,
  active oversight and is fully responsible for any minor's use.
- **Guardian duties.** Use device-level controls, keep the API key out of reach,
  and teach critical evaluation of anything an AI says.
- **Schools and organisations.** Do not deploy this in a youth setting without
  policy, training, supervision, and legal compliance — including student
  privacy and parental consent. The author assumes no duty of care.

## 9) Risk scenarios (non-exhaustive)

- **Mental health and self-harm.** A voice with a personality invites more trust
  than it has earned. Do not rely on it for support. Seek qualified help.
- **Harmful or unlawful instructions.** Models can produce unsafe guidance. You
  are responsible for preventing misuse and for your own actions.
- **False statements about real people.** Models produce confident falsehoods,
  including defamatory ones. Verify before repeating.
- **Specialist error.** Outputs may be wrong or incomplete in any technical
  domain. Consult someone qualified.
- **Privacy and data handling.** Audio, transcripts, and any stored memories
  sent with a call are transmitted to the Provider and may be logged or retained
  by it. Read the Provider's privacy policy.
- **Intellectual property.** Outputs may resemble copyrighted or proprietary
  material. Make sure you have the rights before using or distributing them.
- **Bias and offensive content.** Models produce biased and offensive output.
  Apply your own standards.
- **Tools and automation.** Where tools or MCP servers are enabled, the model
  can act. Validate what goes in and what comes out, and accept responsibility
  for the results.
- **Code the model produces or runs.** The code interpreter executes in the
  Provider's sandbox, not yours, and what it reports back is still model output.
  Nothing the App says about a build has been verified by the author. Read code
  before you run it, review a change before you merge it, and do not let a
  confident-sounding answer stand in for a test.
- **Spoken technical detail.** Versions, flags, paths and identifiers are the
  things a voice model is most likely to get subtly wrong and a listener least
  likely to catch. Check them in writing before acting on them.

## 10) Prohibited uses

- Do not use the App for harassment, bullying, stalking, exploitation,
  discrimination, or other harmful conduct.
- Do not target minors or vulnerable people.
- Do not use it to break the law or infringe anyone's rights.
- Do not use it to impersonate a real person, or to generate audio intended to
  pass as one.

## 11) Warranty, liability, and indemnity

- The App is provided "as is", without warranty of any kind. Use is at your own
  risk.
- To the maximum extent permitted by law, the author disclaims all liability for
  any claim, loss, or damage arising from or related to Outputs or your use of
  the App.
- You agree to defend, indemnify, and hold harmless the author and contributors
  against any claim, damage, liability, cost, or expense arising out of your use
  of the App, what you say to it, your reliance on Outputs, or your violation of
  law or third-party rights.

## 12) Acceptance

By running the App you confirm you have read this document and agree to it. If
you do not agree, do not run it.

## 13) Updates

This document may change. Continued use after a change constitutes acceptance of
the revised version.
