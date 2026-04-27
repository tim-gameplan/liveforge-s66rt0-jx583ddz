# Vision

> An infinite canvas where users can type anywhere to converse with an LLM, which generates interactive animated objects using Anime.js that can be rendered and manipulated on the canvas

## Original brief

> an infinite canvas where i can type anywhere and an llm can respond with any object it can create that can be rendered on the canvas.
> 
> Clarifying questions you asked:
> 1. When you say 'any object it can create' — do you mean visual shapes/drawings, interactive widgets (buttons, forms), text blocks, images, or all of the above?
> 2. Should the LLM responses appear exactly where you type, or can they appear anywhere on the canvas (e.g. offset, draggable)?
> 3. Do you want to be able to move, edit, or delete objects after they're created, or is the canvas append-only?
> 
> My answers:
> https://animejs.com/ converse with the llm to generate any number of ideas using https://animejs.com/. https://freefrontend.com/anime-js-examples/

## What this app is

An infinite canvas where users can type anywhere to converse with an LLM, which generates interactive animated objects using Anime.js that can be rendered and manipulated on the canvas

## Recipe

This app is built with the **vanilla** recipe. It is **AI-native** — runtime LLM access is auto-wired by the LiveForge runtime.

Target devices: desktop.

## Aesthetic direction

Deep charcoal canvas (#1a1a1d) with off-white text (#f5f5f7) for maximum contrast against infinite workspace. Single vibrant accent—electric cyan (#00d9ff)—used exclusively on active input cursor, LLM-generated object selection outlines, and the primary "Ask LLM" button state. Typography: sans-serif at two weights (400 for body, 600 for input fields and object labels), 1.6 line-height for readability at any zoom level. Generous spacing: 24px minimum between canvas objects when LLM places them, 16px padding inside text input bubbles. Motion is constant but subtle: all Anime.js objects enter with 400ms elastic easing, user-dragged objects have 120ms momentum decay, hover states on interactive elements scale to 1.02 over 200ms. Empty canvas shows a single pulsing cyan dot at center (2s loop, opacity 0.3 ↔ 1.0) with invitation text below. Objects cast soft 8px shadows (#000000 at 20% opacity) to lift them from the canvas. Pan/zoom controls in bottom-right: hairline cyan borders, glass-morphism background (backdrop-blur + 10% white overlay).

## Why this matters

You're staring at a blank canvas at 11pm, stuck on how to visualize a concept for tomorrow's presentation. You click somewhere in the void, type "show me a solar system with orbiting planets," and watch as the LLM drops five colored circles that begin tracing elliptical paths around a glowing center—no code, no timeline scrubbing, just fluid motion you can immediately drag into position or ask to modify. The infinite canvas means you can scatter a dozen experiments across the workspace, zoom out to see them all at once, then dive back in to refine the one that clicked. This app turns "I wish I could just describe what I want to see" into a spatial playground where ideas become animated, manipulable artifacts in seconds.

## Key views

### Infinite Canvas

Main workspace where users click to create text input fields and LLM generates animated objects

Must include:

- Pan/zoom infinite canvas viewport
- Click-to-type text input fields positioned at click coordinates
- LLM-generated animated objects using Anime.js
- Draggable, editable, deletable canvas objects
- Conversation history/context panel

## Data model

### `CanvasObject`

- `id`: unique identifier
- `type`: text_input | llm_response | animated_element
- `position`: { x: number, y: number }
- `content`: text or animation config
- `animation`: Anime.js animation definition (if applicable)

### `Conversation`

- `messages`: array of user inputs and LLM responses
- `canvas_objects`: array of CanvasObject references

## Non-goals

- No framework — runtime AI helper requires single-file vanilla structure
- Not a traditional chat interface — conversation happens spatially on canvas
- LLM generates animation code, not pre-made templates

## Design intent

Build something a user would actually enjoy using — the kind of app that earns a screenshot in a designer's portfolio. Specifically:

- **Visual hierarchy**: a clear primary action per view, considered typography (multiple weights, generous line-height), deliberate color choices (one accent used sparingly is more powerful than five).
- **Considered empty states**: when there's no data yet, show an illustration or large icon plus welcoming copy that invites the user to act. Never an unstyled paragraph.
- **Microinteractions on the moments that matter**: a subtle fade or scale on the primary CTA hover, a satisfying state-change animation when the user completes the action the app is built around. Restraint shows up as 200ms fades, not as removing animation entirely.
- **Surfaces over text**: prefer cards, panels, and grouped containers to bare text. Padding, soft shadows or hairline borders, and rounded corners are baseline — not decoration.
- **The brief is the floor, not the ceiling**: when in doubt, ship the more designed option.

---

_Auto-generated from the spec by the LiveForge scaffolder. Edit by re-running the build with a refined brief._
