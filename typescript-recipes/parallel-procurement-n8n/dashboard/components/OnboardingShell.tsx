import type { ReactNode } from "react";

export function OnboardingShell({
  step,
  totalSteps = 3,
  title,
  subtitle,
  children,
}: {
  step: number;
  totalSteps?: number;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-step-badge">
          <span className="onboarding-step-progress">
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                className={`onboarding-step-dot${i + 1 <= step ? " active" : ""}`}
              />
            ))}
          </span>
          <span>
            Step {step} of {totalSteps}
          </span>
        </div>
        <h1 className="onboarding-title">{title}</h1>
        <p className="onboarding-subtitle">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}
