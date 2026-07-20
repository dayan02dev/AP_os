// Mentor pod card — Approach step 1 (Mentors). Faithful port of
// TIR Onboarding.dc.html's showMentors card markup.
const AVATAR_COLORS = ["var(--artblue)", "var(--accent-violet)", "var(--artblack)"];

export default function MentorCard({ mentor, index = 0 }) {
  return (
    <div className="card fj-mentor-card">
      <div className="fj-mentor-avatar" style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}>
        {mentor.initials}
      </div>
      <div className="fj-mentor-body">
        <div className="fj-mentor-name-row">
          <span className="fj-mentor-name">{mentor.name}</span>
          <span className="fj-mentor-role">{mentor.role}</span>
        </div>
        <p className="fj-mentor-bio">{mentor.bio}</p>
        <div className="fj-mentor-tags">
          {(mentor.tags || []).map((t) => (
            <span key={t} className="fj-mentor-tag">{t}</span>
          ))}
        </div>
        <div className="fj-mentor-brings"><strong>Brings you: </strong>{mentor.brings}</div>
      </div>
      <div className="fj-mentor-side">
        <span className="fj-mentor-hours"><span className="dot green" /> Office hours {mentor.hours}</span>
        <a href="#" className="fj-mentor-book" onClick={(e) => e.preventDefault()}>Book intro call →</a>
      </div>
    </div>
  );
}
