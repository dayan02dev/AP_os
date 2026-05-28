// EmptyAnswer — italic muted placeholder for unanswered questions.
//
// The brief is explicit: "Empty fields render as 'No answer provided' italic
// placeholders, NOT blank boxes." Centralised here so every answer renderer
// can fall through to the same string.

export default function EmptyAnswer({ message = "No answer provided" }) {
  return <p className="ans-empty">{message}</p>;
}
