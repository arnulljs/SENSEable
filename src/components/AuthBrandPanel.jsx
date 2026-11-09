// components/AuthBrandPanel.jsx — Left-hand brand panel shared by the
// Login and Create Account screens, so the two stay visually identical
// without duplicating markup.
const FEATURES = [
  { title: 'Multi-sensor monitoring', text: 'Dissolved oxygen, salinity, temperature \u2014 and whatever ESP32 modules report in next.' },
  { title: 'Role-based workspaces',   text: 'Designers lay out the site map; Operators monitor and calibrate without touching the layout.' },
  { title: 'Per-organization isolation', text: 'Every device, layout, and teammate stays scoped to your own workspace.' },
];

export default function AuthBrandPanel() {
  return (
    <div className="auth-brand-panel">
      <img className="auth-brand-logo" src="/logo-full.png" alt="SENSEable" />

      <p className="auth-brand-tagline">
        A scalable IoT framework for multi-sensor environmental monitoring
        and regulation.
      </p>

      <ul className="auth-feature-list">
        {FEATURES.map(f => (
          <li key={f.title}>
            <span className="auth-feature-title">{f.title}</span>
            <span className="auth-feature-text">{f.text}</span>
          </li>
        ))}
      </ul>

      <div className="auth-brand-footer">
        Group N &middot; CPE 3207L (CPE Research) &middot; University of San Carlos
      </div>
    </div>
  );
}
