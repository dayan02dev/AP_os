// QuestionBlock — one numbered question + its answer renderer.
//
// The answer renderer is chosen by question.type from the schema. Empty
// answers always render the muted "No answer provided" placeholder via
// EmptyAnswer — every renderer falls through to that on null/empty values.

import TextAnswer from "./answers/TextAnswer.jsx";
import ChoiceAnswer from "./answers/ChoiceAnswer.jsx";
import MultiChoiceAnswer from "./answers/MultiChoiceAnswer.jsx";
import FileGridAnswer from "./answers/FileGridAnswer.jsx";
import VideoAnswer from "./answers/VideoAnswer.jsx";
import DeclarationAnswer from "./answers/DeclarationAnswer.jsx";
import TeamListAnswer from "./answers/TeamListAnswer.jsx";
import CapTableAnswer from "./answers/CapTableAnswer.jsx";

function renderAnswer(question, application, applicationId, signedUrl) {
  const value = application ? application[question.key] : undefined;
  switch (question.type) {
    case "choice":
      return <ChoiceAnswer value={value} options={question.options} />;
    case "multi-choice":
      return <MultiChoiceAnswer value={value} options={question.options} />;
    case "files":
    case "file":
      return <FileGridAnswer value={value} applicationId={applicationId} signedUrl={signedUrl} />;
    case "video":
      return <VideoAnswer value={value} />;
    case "declaration":
      return <DeclarationAnswer application={application} items={question.items} />;
    case "team":
      return <TeamListAnswer value={value} />;
    case "captable":
      return <CapTableAnswer value={value} />;
    case "text":
    default:
      return <TextAnswer value={value} />;
  }
}

export default function QuestionBlock({ question, application, applicationId, signedUrl }) {
  const chipLabel = question.required ? "Required" : "Optional";
  const chipClass = question.required ? "required" : "optional";
  return (
    <div className="q-block">
      <div className="q-block-head">
        <span className="q-block-num">{question.number} →</span>
        <span className={`q-block-chip ${chipClass}`}>{chipLabel}</span>
      </div>
      <h3 className="q-block-label">{question.label}</h3>
      {question.help && <p className="q-block-help">{question.help}</p>}
      {renderAnswer(question, application, applicationId, signedUrl)}
    </div>
  );
}
