import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFlash } from '../../utils/useFlash';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pin,
  PinOff,
  RotateCcw,
  ShieldOff,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AnalyticsSettings,
  ProviderRecommendation,
  ProviderScore,
  RankingCriterionInfo,
} from '../../types/analytics';

/**
 * What every provider has actually done, and the score built from it.
 *
 * The screen exists so the ranking is arguable. A system that quietly reorders
 * search results and picks default sources on evidence nobody can see is one
 * users learn to distrust the first time it is wrong — and with hundreds of
 * scrapers of third-party sites it will sometimes be wrong. So every number is
 * shown, every criterion says what it measured and how many observations it
 * has, and a user can override any of it by hand.
 *
 * The privacy controls are here too rather than buried elsewhere, next to the
 * data they govern: what is collected, and the button that erases it.
 */

const BAND_LABELS: Record<string, { label: string; tone: string }> = {
  strong: { label: 'Strong', tone: 'strong' },
  good: { label: 'Good', tone: 'good' },
  unproven: { label: 'Not enough data', tone: 'unproven' },
  weak: { label: 'Weak', tone: 'weak' },
  failing: { label: 'Failing', tone: 'failing' },
};

export const ProviderRankingPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState<ProviderScore[]>([]);
  const [criteria, setCriteria] = useState<RankingCriterionInfo[]>([]);
  const [settings, setSettings] = useState<AnalyticsSettings | null>(null);
  const [recommendations, setRecommendations] = useState<ProviderRecommendation[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showWeights, setShowWeights] = useState(false);
  const { message: flashMessage, flash: setFlash } = useFlash<string>(4000);

  const load = useCallback(async () => {
    const [board, recs] = await Promise.all([
      window.cloudstream?.getProviderLeaderboard?.(),
      window.cloudstream?.getProviderRecommendations?.(8),
    ]);
    if (board?.ok) {
      setScores(board.scores ?? []);
      setCriteria(board.criteria ?? []);
      if (board.settings) setSettings(board.settings);
    }
    if (recs?.ok) setRecommendations(recs.recommendations ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const say = (message: string) => {
    setFlash(message);
  };

  const updateSettings = async (patch: Partial<AnalyticsSettings>) => {
    const response = await window.cloudstream?.setAnalyticsSettings?.(patch);
    if (response?.ok) setSettings(response.settings);
  };

  const setPreference = async (provider: string, preference: 'preferred' | 'blocked' | null) => {
    await window.cloudstream?.setProviderPreference?.(provider, preference);
    void load();
  };

  /** Measured providers first; the never-used tail is noise at the top. */
  const measured = useMemo(() => scores.filter((score) => score.samples > 0), [scores]);
  const unmeasured = useMemo(() => scores.filter((score) => score.samples === 0), [scores]);

  if (loading) {
    return (
      <div className="ranking__loading">
        <Loader2 size={16} className="spin" /> Reading provider history…
      </div>
    );
  }

  return (
    <div className="ranking">
      {flashMessage && <div className="settings__flash">{flashMessage}</div>}

      {/* --- what is collected, and the switch --------------------------- */}
      <section className="setting-group">
        <h3>
          <BarChart3 size={15} /> Provider performance
        </h3>

        <label className="ranking__toggle">
          <input
            type="checkbox"
            checked={settings?.enabled ?? true}
            onChange={(event) => void updateSettings({ enabled: event.target.checked })}
          />
          <span>
            <strong>Measure how each provider performs</strong>
            <em>
              Counts only: how often a provider answered, how fast, and whether what it returned
              played. No titles, no searches and no viewing history are recorded, and nothing is
              sent anywhere — this file never leaves your machine.
            </em>
          </span>
        </label>

        <label className="ranking__toggle">
          <input
            type="checkbox"
            checked={settings?.applyToRanking ?? true}
            disabled={!settings?.enabled}
            onChange={(event) => void updateSettings({ applyToRanking: event.target.checked })}
          />
          <span>
            <strong>Use it to order results and pick default sources</strong>
            <em>
              Off means the measurements are still shown here but nothing acts on them.
            </em>
          </span>
        </label>

        <label className="ranking__toggle">
          <input
            type="checkbox"
            checked={settings?.autoEnableProven ?? false}
            disabled={!settings?.enabled}
            onChange={(event) => void updateSettings({ autoEnableProven: event.target.checked })}
          />
          <span>
            <strong>Turn on providers that prove themselves</strong>
            <em>
              A provider you have switched off is re-enabled once it scores{' '}
              {settings?.autoEnableMinScore ?? 70} or better over{' '}
              {settings?.autoEnableMinSamples ?? 25} recorded outcomes. Nothing is ever switched
              off automatically.
            </em>
          </span>
        </label>

        <div className="ranking__actions">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              const response = await window.cloudstream?.applyProviderAutoEnable?.();
              const count = response?.enabled?.length ?? 0;
              say(
                count > 0
                  ? `Enabled ${count} provider${count === 1 ? '' : 's'}: ${response!.enabled.join(', ')}`
                  : 'No provider has enough evidence to be enabled yet.'
              );
              void load();
            }}
          >
            <Sparkles size={14} /> Apply now
          </button>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await window.cloudstream?.resetProviderAnalytics?.();
              say('Provider history erased.');
              void load();
            }}
          >
            <Trash2 size={14} /> Erase all history
          </button>
        </div>
      </section>

      {/* --- recommendations --------------------------------------------- */}
      {recommendations.length > 0 && (
        <section className="setting-group">
          <h3>
            <Sparkles size={15} /> Recommended providers
          </h3>
          <p className="ranking__note">
            Based on what has actually worked for you, not on popularity.
          </p>
          <ul className="ranking__recs">
            {recommendations.map((rec) => (
              <li key={rec.provider}>
                <div>
                  <strong>{rec.provider}</strong>
                  {rec.extensionName && (
                    <span className="ranking__origin">
                      {rec.repositoryName ? `${rec.repositoryName} ▸ ` : ''}
                      {rec.extensionName}
                    </span>
                  )}
                  <em>{rec.reason}</em>
                </div>
                <span className={`ranking__badge ranking__badge--${BAND_LABELS[rec.band]?.tone}`}>
                  {rec.score}
                </span>
                {!rec.currentlyEnabled && <span className="ranking__off">currently off</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- the criteria and their weights ------------------------------- */}
      <section className="setting-group">
        <h3>
          <button className="ranking__disclose" onClick={() => setShowWeights((open) => !open)}>
            {showWeights ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            How the score is worked out
          </button>
        </h3>

        {showWeights && (
          <>
            <p className="ranking__note">
              Each criterion contributes in proportion to its weight. A criterion with no data is
              left out of the average rather than counted as zero — a provider you have never
              downloaded from is not ranked below one whose downloads always fail.
            </p>
            <ul className="ranking__criteria">
              {criteria.map((criterion) => (
                <li key={criterion.id} className={criterion.available ? '' : 'ranking__criterion--soon'}>
                  <div>
                    <strong>{criterion.label}</strong>
                    <em>{criterion.description}</em>
                  </div>
                  {criterion.available ? (
                    <label>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={criterion.weight}
                        onChange={async (event) => {
                          const response = await window.cloudstream?.setRankingWeight?.(
                            criterion.id,
                            parseFloat(event.target.value)
                          );
                          if (response?.ok) setCriteria(response.criteria);
                        }}
                      />
                      <span>{criterion.weight.toFixed(2)}</span>
                    </label>
                  ) : (
                    <span className="ranking__soon">not measured yet</span>
                  )}
                </li>
              ))}
            </ul>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const response = await window.cloudstream?.resetRankingWeights?.();
                if (response?.ok) setCriteria(response.criteria);
              }}
            >
              <RotateCcw size={14} /> Reset weights
            </button>
          </>
        )}
      </section>

      {/* --- the leaderboard ---------------------------------------------- */}
      <section className="setting-group">
        <h3>Every provider, ranked</h3>
        {measured.length === 0 ? (
          <p className="ranking__note">
            Nothing measured yet. Run a few searches and play something; scores appear as evidence
            accumulates.
          </p>
        ) : (
          <ul className="ranking__list">
            {measured.map((score) => {
              const open = expanded === score.provider;
              const band = BAND_LABELS[score.band] ?? BAND_LABELS.unproven;
              return (
                <li key={score.provider} className="ranking__row">
                  <button
                    className="ranking__head"
                    onClick={() => setExpanded(open ? null : score.provider)}
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className={`ranking__badge ranking__badge--${band.tone}`}>
                      {score.score}
                    </span>
                    <span className="ranking__name">{score.provider}</span>
                    {score.preference === 'preferred' && <Pin size={12} />}
                    {score.preference === 'blocked' && <ShieldOff size={12} />}
                    <span className="ranking__meta">
                      {band.label} · {score.samples} outcome{score.samples === 1 ? '' : 's'}
                    </span>
                  </button>

                  {open && (
                    <div className="ranking__detail">
                      {(score.repositoryName || score.extensionName) && (
                        <p className="ranking__origin">
                          {[score.repositoryName, score.extensionName].filter(Boolean).join(' ▸ ')}
                        </p>
                      )}
                      <dl>
                        {score.criteria.map((criterion) => (
                          <React.Fragment key={criterion.id}>
                            <dt>{criterion.label}</dt>
                            <dd>
                              {criterion.score === null
                                ? '—'
                                : `${Math.round(criterion.score * 100)}%`}
                              <em>{criterion.detail}</em>
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                      <div className="ranking__row-actions">
                        <button
                          onClick={() =>
                            void setPreference(
                              score.provider,
                              score.preference === 'preferred' ? null : 'preferred'
                            )
                          }
                        >
                          {score.preference === 'preferred' ? (
                            <>
                              <PinOff size={13} /> Unpin
                            </>
                          ) : (
                            <>
                              <Pin size={13} /> Always prefer
                            </>
                          )}
                        </button>
                        <button
                          onClick={() =>
                            void setPreference(
                              score.provider,
                              score.preference === 'blocked' ? null : 'blocked'
                            )
                          }
                        >
                          <ShieldOff size={13} />
                          {score.preference === 'blocked' ? 'Unblock' : 'Never use'}
                        </button>
                        <button
                          onClick={async () => {
                            await window.cloudstream?.resetProviderAnalytics?.(score.provider);
                            void load();
                          }}
                        >
                          <Trash2 size={13} /> Forget its history
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {unmeasured.length > 0 && (
          <p className="ranking__note">
            {unmeasured.length} more provider{unmeasured.length === 1 ? ' has' : 's have'} not been
            used yet. They are searched at normal priority until there is something to judge them
            on.
          </p>
        )}
      </section>
    </div>
  );
};
