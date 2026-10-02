# Sharing the Vantage explainer set

Two messages, written 2026-10-02 for the first use after the Verizon showing and kept here because the set
names no customer and is reused as it stands: the note to the account executive team, and the email the
account owner sends the customer's engineers. Replace the bracketed fields; change nothing else without
re-reading the three pieces, because every claim in these messages is one they make.

## To the account executive team

Team, the Vantage carrier demo now has a companion set for the question every technical buyer asks after a
demo: "isn't this just click tracking?" It is three pieces, none of them naming a customer, so you can send
them to any prospect once they have seen the demo:

- A one-page note, *Why the unit of state is the dimension value, not the click*. Five questions any design
  that personalises from behaviour has to answer, and how one piece of arithmetic answers all five. For
  anyone, technical or not.
- A technical note, *How the Vantage signal system works*. The first three pages walk through the whole
  system in plain words with one figure; each section links to its detail further down: the formulas, the
  numbers measured on the hosted demo, the published configuration documents, and what we need from a
  customer's product catalog in this use case. Business readers stop after page five; engineers click through.
- An interactive page, https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works. Every
  constant in the system is on a slider, every section explains itself before it shows its instruments, and
  the page recomputes a real decision receipt from the demo so an engineer can check the numbers.

How to use them: send the email below after the demo, from the account owner, to the customer's technical
lead, with the two Word files attached and the link in the body. Let their engineers play with the page before
the next conversation. Three rules we hold to in every one of these: we explain our own reasoning and never
describe or judge what the customer has built; every number is either measured on the demo or a published
constant, and is labelled as such; and the learning claim is exact, the system records outcomes from day one
and moves nothing until the dial is turned.

The files are in the repository under `docs/verizon/`: `Vantage-Why-Dimensions-Not-Clicks-v1.3.docx` and
`Vantage-Signal-System-Technical-Note-v1.1.docx`. Use the highest version number present.

## The email to the customer's engineers

Subject: How the Vantage signal system works

Hi [Name],

Thank you for your time on [day]. Following our conversation about how the signal system decides what to
show, I'm sharing two documents with you:

- *Why the unit of state is the dimension value, not the click*, one page. The five questions any design that
  personalises from behaviour has to answer, and how one piece of arithmetic answers all five.
- *How the Vantage signal system works*, a technical note. The first three pages walk through the whole
  system in plain words; each section links to the detail further down, with the formulas, the numbers
  measured on the demo, the published configuration documents, and what we would need from a product
  catalog in this use case. Read the first three pages and click through wherever you want the math.

We have also put the arithmetic on an interactive page:

https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works

Every constant is on a slider there: the memory horizons, the entry and exit thresholds, a slot's weights, the
strength of the regional prior, the learning dial. Moving one shows you how the outcome changes, and each
control says where that value is published, so you can see how the system is governed: everything that moves
an answer is a versioned value in a published document, not code. The page also recomputes a real decision
receipt from the demo, so you can check the numbers yourself.

The goal is simply for you and your team to have this and get familiar with how it works before we speak
again. If any of it raises questions, I would be glad to walk through it with you.

Best regards,
[Name]
