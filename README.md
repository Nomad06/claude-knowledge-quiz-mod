# Claude knowledge quiz mod (`task-quiz`)

A Claude Code mod that shows you a random practice question in a band above the prompt every time you start a task. The quiz is for you alone: your prompt reaches the model unchanged, nothing about the quiz enters the model's context, and the question is drawn only after your task has started, so it never delays or blocks it.

176 questions across six practice sets are bundled in `hooks/questions.ts`; the mod fetches nothing at run time.

## Install

In a Claude Code terminal session:

```
/plugin install task-quiz --marketplace Nomad06/claude-knowledge-quiz-mod
```

Answer `y` to add the marketplace, pick a scope (user scope first), and set the `every` option if you like. The next task you start shows a question.

From a local copy instead: `claude plugin marketplace add ./task-quiz`, then `/plugin install task-quiz@task-quiz`.

## Using it

- Start any task: a question appears above the prompt, header first (domain, set, and **Pick 2** when two answers are needed).
- Pick-1 questions grade on click. Pick-2 questions: toggle two options, then **Submit**; only the exact correct pair counts.
- After grading you see ✓/✗ on your choices, → on a correct option you missed, the explanation, and **Next question** / **Dismiss**.
- Options are reshuffled every time a question is shown.
- A deck of question ids is kept across sessions, so nothing repeats until every question has been shown.
- The status line reads `Quiz <correct>/<answered> · streak <n>`.

On the terminal and desktop the quiz draws in the band above the prompt. The Claude mobile app (and VS Code) has no such band, so there the quiz opens in a pane.

| Command | Does |
| --- | --- |
| `/quiz` | Show a question now (works even while paused) |
| `/quiz-off`, `/quiz-on` | Pause or resume the per-task question |
| `/quiz-stats` | Overall accuracy and your 3 weakest domains |
| `/quiz-set <1-6\|all>` | Limit questions to one practice set |
| `/quiz-reset` | Clear stats and the deck |

Commands answer in the band and as toasts rather than as transcript text, so the model never reads them.

**Option** `every` (default 1): show a question on every Nth task. Set it in `/config` or at install.

## Development

```
claude plugin validate .
claude plugin test .
tsc -p .            # once Claude Code has loaded the mod and laid .claude-plugin/types/
```
