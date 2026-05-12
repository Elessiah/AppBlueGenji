import type { BracketMatch } from "@/lib/shared/types";
import { useScoreForm } from "../_hooks/useScoreForm";

interface ScoreInputDialogProps {
  match: BracketMatch | null;
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

export function ScoreInputDialog({ match, open, onClose, onSubmitted }: ScoreInputDialogProps) {
  const form = useScoreForm(match);

  if (!open || !match) return null;

  const handleSaveScores = async () => {
    const ok = await form.submit("save");
    if (ok) {
      onSubmitted();
      onClose();
    }
  };

  const handleDefineWinner = async () => {
    const ok = await form.submit("resolve");
    if (ok) {
      onSubmitted();
      onClose();
    }
  };

  const s1Num = Number(form.score1);
  const s2Num = Number(form.score2);
  const scoresAreFiniteNumbers = Number.isFinite(s1Num) && Number.isFinite(s2Num);
  const canSaveScores = form.forfeitTeamId ? true : scoresAreFiniteNumbers;
  const canDeclareWinner = form.forfeitTeamId ? true : scoresAreFiniteNumbers && s1Num !== s2Num;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.65)",
          zIndex: 999,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "linear-gradient(135deg, rgba(89,212,255,0.12) 0%, rgba(89,212,255,0.06) 100%)",
          border: `2px solid rgba(89,212,255,0.5)`,
          borderRadius: 12,
          padding: 32,
          maxWidth: 540,
          width: "90vw",
          maxHeight: "90vh",
          overflow: "auto",
          zIndex: 1000,
          boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(89,212,255,0.2), inset 0 1px 0 rgba(89,212,255,0.1)",
          backdropFilter: "blur(4px)",
        }}
      >
        <h2 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 700, color: "var(--text-0)" }}>
          Éditer le score du match
        </h2>

        {form.forfeitTeamId && (
          <div
            style={{
              marginBottom: 20,
              padding: 12,
              background: "rgba(255,157,46,0.12)",
              border: "1px solid rgba(255,157,46,0.35)",
              borderRadius: 6,
              fontSize: 13,
              color: "rgba(255,157,46,0.9)",
            }}
          >
            ⚠ Forfait déclaré : {form.forfeitTeamId === match.team1Id ? match.team1Name || "Équipe 1" : match.team2Name || "Équipe 2"} a déclaré forfait
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "end" }}>
            <div>
              <label
                style={{
                  display: "block",
                  margin: "0 0 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "rgba(89,212,255,0.9)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {match.team1Name || "Équipe 1"}
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.max(0, Number(form.score1 || 0) - 1);
                    form.setScore1(String(val));
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(89,212,255,0.15)",
                    border: "1px solid rgba(89,212,255,0.3)",
                    borderRadius: 6,
                    color: "rgba(89,212,255,0.9)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  disabled={form.submitting}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.25)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.15)";
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={form.score1}
                  onChange={(e) => form.setScore1(e.target.value)}
                  autoFocus
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "10px 12px",
                    fontSize: 22,
                    fontWeight: 700,
                    textAlign: "center",
                    background: "var(--surface-1)",
                    border: `2px solid rgba(89,212,255,0.4)`,
                    borderRadius: 8,
                    color: "var(--text-0)",
                    transition: "border-color 0.2s",
                  }}
                  disabled={form.submitting}
                />
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.min(99, Number(form.score1 || 0) + 1);
                    form.setScore1(String(val));
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(89,212,255,0.15)",
                    border: "1px solid rgba(89,212,255,0.3)",
                    borderRadius: 6,
                    color: "rgba(89,212,255,0.9)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  disabled={form.submitting}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.25)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.15)";
                  }}
                >
                  +
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>vs</span>
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  margin: "0 0 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "rgba(89,212,255,0.9)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {match.team2Name || "Équipe 2"}
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.max(0, Number(form.score2 || 0) - 1);
                    form.setScore2(String(val));
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(89,212,255,0.15)",
                    border: "1px solid rgba(89,212,255,0.3)",
                    borderRadius: 6,
                    color: "rgba(89,212,255,0.9)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  disabled={form.submitting}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.25)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.15)";
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={form.score2}
                  onChange={(e) => form.setScore2(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "10px 12px",
                    fontSize: 22,
                    fontWeight: 700,
                    textAlign: "center",
                    background: "var(--surface-1)",
                    border: `2px solid rgba(89,212,255,0.4)`,
                    borderRadius: 8,
                    color: "var(--text-0)",
                    transition: "border-color 0.2s",
                  }}
                  disabled={form.submitting}
                />
                <button
                  type="button"
                  onClick={() => {
                    const val = Math.min(99, Number(form.score2 || 0) + 1);
                    form.setScore2(String(val));
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    background: "rgba(89,212,255,0.15)",
                    border: "1px solid rgba(89,212,255,0.3)",
                    borderRadius: 6,
                    color: "rgba(89,212,255,0.9)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                  disabled={form.submitting}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.25)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(89,212,255,0.15)";
                  }}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 24, paddingTop: 20, borderTop: "1px solid rgba(89,212,255,0.2)" }}>
          <p
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.09em",
              color: "var(--text-2)",
              margin: "0 0 12px",
              fontWeight: 700,
            }}
          >
            Forfait
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => form.setForfeitTeamId(form.forfeitTeamId === match.team1Id ? undefined : match.team1Id ?? undefined)}
              style={{
                flex: 1,
                padding: "10px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: form.forfeitTeamId === match.team1Id ? "rgba(255,157,46,0.2)" : "rgba(255,157,46,0.08)",
                border: `2px solid rgba(255,157,46,${form.forfeitTeamId === match.team1Id ? 0.5 : 0.25})`,
                borderRadius: 6,
                color: form.forfeitTeamId === match.team1Id ? "rgba(255,157,46,1)" : "rgba(255,157,46,0.6)",
                cursor: form.submitting ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
              disabled={form.submitting}
            >
              {match.team1Name || "Équipe 1"}
            </button>
            <button
              type="button"
              onClick={() => form.setForfeitTeamId(form.forfeitTeamId === match.team2Id ? undefined : match.team2Id ?? undefined)}
              style={{
                flex: 1,
                padding: "10px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: form.forfeitTeamId === match.team2Id ? "rgba(255,157,46,0.2)" : "rgba(255,157,46,0.08)",
                border: `2px solid rgba(255,157,46,${form.forfeitTeamId === match.team2Id ? 0.5 : 0.25})`,
                borderRadius: 6,
                color: form.forfeitTeamId === match.team2Id ? "rgba(255,157,46,1)" : "rgba(255,157,46,0.6)",
                cursor: form.submitting ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
              disabled={form.submitting}
            >
              {match.team2Name || "Équipe 2"}
            </button>
            {form.forfeitTeamId && (
              <button
                type="button"
                onClick={() => form.setForfeitTeamId(undefined)}
                style={{
                  padding: "10px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "rgba(89,212,255,0.08)",
                  border: "1px solid rgba(89,212,255,0.25)",
                  borderRadius: 6,
                  color: "rgba(89,212,255,0.6)",
                  cursor: form.submitting ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                }}
                disabled={form.submitting}
              >
                Annuler forfait
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 12, alignItems: "stretch" }}>
          <button
            type="button"
            onClick={onClose}
            className="btn"
            style={{
              padding: "12px 16px",
              fontSize: 14,
              fontWeight: 600,
              background: "var(--surface-1)",
              borderColor: "var(--border)",
              color: "var(--text-1)",
              cursor: form.submitting ? "not-allowed" : "pointer",
              opacity: form.submitting ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
            disabled={form.submitting}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSaveScores}
            className="btn"
            style={{
              padding: "12px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: canSaveScores ? "rgba(79,224,162,0.15)" : "rgba(79,224,162,0.05)",
              borderColor: "rgba(79,224,162,0.4)",
              color: canSaveScores ? "rgba(79,224,162,1)" : "rgba(79,224,162,0.5)",
              cursor: canSaveScores && !form.submitting ? "pointer" : "not-allowed",
              opacity: canSaveScores && !form.submitting ? 1 : 0.5,
              transition: "all 0.2s",
            }}
            disabled={!canSaveScores || form.submitting}
          >
            {form.submitting ? "..." : "OK"}
          </button>
          <button
            type="button"
            onClick={handleDefineWinner}
            className="btn"
            style={{
              padding: "12px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: canDeclareWinner ? "rgba(89,212,255,0.2)" : "rgba(89,212,255,0.08)",
              borderColor: "rgba(89,212,255,0.5)",
              color: canDeclareWinner ? "rgba(89,212,255,1)" : "rgba(89,212,255,0.5)",
              cursor: canDeclareWinner && !form.submitting ? "pointer" : "not-allowed",
              opacity: canDeclareWinner && !form.submitting ? 1 : 0.5,
              transition: "all 0.2s",
            }}
            disabled={!canDeclareWinner || form.submitting}
          >
            {form.submitting ? "..." : "✓ Gagnant"}
          </button>
        </div>
      </div>
    </>
  );
}
