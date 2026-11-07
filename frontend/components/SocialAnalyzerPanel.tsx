"use client";

import { useEffect, useState } from "react";
import { Panel } from "./Panel";
import { EmptyState } from "./badges";
import { useLanguage } from "../lib/i18n";

/**
 * Analizador de redes sociales (estilo Social Blade, datos honestos).
 *
 * NO descarga datos en vivo de ninguna red: Social Blade no ofrece API
 * pública gratuita (su Business API es de pago, con créditos prepagados y
 * clave), y las redes tampoco exponen contadores públicos sin clave. Por
 * eso el usuario pega la URL o el usuario del perfil y escribe las
 * métricas a mano; la app solo valida el formato, detecta la red por la
 * URL y calcula una ESTIMACIÓN HEURÍSTICA (0-100) con los datos dados.
 * Ningún número mostrado es un dato en vivo: o lo escribió el usuario o
 * lleva la etiqueta de estimación heurística.
 *
 * Guardado solo en localStorage (clave `grow-social-analyses`), sin
 * backend: otro agente (Auditor) lee esa clave con esta forma exacta:
 * { id, network, handle, url, analyzedAt, followers, engagement, score,
 *   level, notes }.
 */

export type SocialNetwork = "instagram" | "tiktok" | "youtube" | "facebook" | "x";
export type SocialLevel = "low" | "medium" | "high";

export type SocialAnalysis = {
  id: string;
  network: string;
  handle: string;
  url: string;
  analyzedAt: string;
  followers: number | null;
  engagement: number | null;
  score: number;
  level: SocialLevel;
  notes: string;
};

const STORAGE_KEY = "grow-social-analyses";

const NETWORKS: SocialNetwork[] = ["instagram", "tiktok", "youtube", "facebook", "x"];

const HOST_TO_NETWORK: Array<[string, SocialNetwork]> = [
  ["instagram.com", "instagram"],
  ["instagr.am", "instagram"],
  ["tiktok.com", "tiktok"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["x.com", "x"],
  ["twitter.com", "x"],
];

/** Formato de usuario aceptado por red (solo validación de forma, no
 *  comprueba que el perfil exista). */
const HANDLE_PATTERNS: Record<SocialNetwork, RegExp> = {
  instagram: /^(?!.*\.\.)(?!.*\.$)[A-Za-z0-9._]{1,30}$/,
  tiktok: /^[A-Za-z0-9._]{2,24}$/,
  youtube: /^@?[A-Za-z0-9._-]{3,30}$/,
  facebook: /^[A-Za-z0-9.]{5,50}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
};

function detectNetworkFromHost(host: string): SocialNetwork | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  for (const [domain, network] of HOST_TO_NETWORK) {
    if (h === domain || h.endsWith(`.${domain}`)) return network;
  }
  return null;
}

function handleFromPath(network: SocialNetwork, pathname: string): string {
  const parts = pathname.split("/").map((p) => decodeURIComponent(p).trim()).filter(Boolean);
  if (parts.length === 0) return "";
  // YouTube: /@usuario, /channel/UC..., /c/nombre, /user/nombre
  if (network === "youtube") {
    if (parts[0].startsWith("@")) return parts[0];
    if ((parts[0] === "channel" || parts[0] === "c" || parts[0] === "user") && parts[1]) return parts[1];
    return parts[0];
  }
  // TikTok: /@usuario[/video/...] — el usuario es el primer segmento.
  // Instagram/Facebook/X: primer segmento (sin @).
  return parts[0].replace(/^@/, "");
}

function parseInput(raw: string): { network: SocialNetwork | null; handle: string; url: string } {
  const value = raw.trim();
  const looksLikeUrl = /^(https?:\/\/|www\.)/i.test(value) || HOST_TO_NETWORK.some(([d]) => value.toLowerCase().includes(d));
  if (!looksLikeUrl) return { network: null, handle: value.replace(/^@/, ""), url: "" };
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { network: null, handle: "", url: value };
  }
  const network = detectNetworkFromHost(parsed.hostname);
  const handle = network ? handleFromPath(network, parsed.pathname) : "";
  return { network, handle, url: parsed.toString() };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Puntaje heurístico 0-100, solo con los datos dados:
 *  - interacción (0-60): >=6% → 60; >=3% → 45; >=1% → 30; >0 → 15.
 *  - audiencia (0-20): >=100.000 → 20; >=10.000 → 15; >=1.000 → 10; >0 → 5.
 *  - datos completos (0-20): perfil válido 10; seguidores 5; promedios 5.
 *  Sin métricas el máximo es 10: la estimación lo refleja, no lo inventa. */
function computeScore(followers: number | null, engagement: number | null, hasAverages: boolean): number {
  let score = 10; // perfil válido
  if (engagement !== null) {
    if (engagement >= 6) score += 60;
    else if (engagement >= 3) score += 45;
    else if (engagement >= 1) score += 30;
    else if (engagement > 0) score += 15;
  }
  if (followers !== null) {
    if (followers >= 100000) score += 20;
    else if (followers >= 10000) score += 15;
    else if (followers >= 1000) score += 10;
    else if (followers > 0) score += 5;
    score += 5;
  }
  if (hasAverages) score += 5;
  return Math.min(100, score);
}

function levelFor(score: number): SocialLevel {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function levelCls(level: SocialLevel): string {
  if (level === "high") return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40";
  if (level === "medium") return "bg-amber-500/15 text-amber-300 ring-amber-500/40";
  return "bg-red-500/15 text-red-300 ring-red-500/40";
}

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40";

function loadSaved(): SocialAnalysis[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is SocialAnalysis =>
        typeof a === "object" && a !== null && typeof (a as SocialAnalysis).id === "string"
    );
  } catch {
    return [];
  }
}

export function SocialAnalyzerPanel() {
  const { t } = useLanguage();
  const [input, setInput] = useState("");
  const [network, setNetwork] = useState<SocialNetwork>("instagram");
  const [followers, setFollowers] = useState("");
  const [likes, setLikes] = useState("");
  const [comments, setComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SocialAnalysis | null>(null);
  const [saved, setSaved] = useState<SocialAnalysis[]>([]);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  const persist = (list: SocialAnalysis[]) => {
    setSaved(list);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // localStorage lleno o no disponible: el análisis en pantalla sigue.
    }
  };

  const onInputChange = (value: string) => {
    setInput(value);
    const { network: detected } = parseInput(value);
    if (detected) setNetwork(detected);
  };

  const networkLabel = (n: SocialNetwork): string => {
    if (n === "instagram") return t.social.netInstagram;
    if (n === "tiktok") return t.social.netTiktok;
    if (n === "youtube") return t.social.netYoutube;
    if (n === "facebook") return t.social.netFacebook;
    return t.social.netX;
  };

  const levelLabel = (level: SocialLevel): string => {
    if (level === "high") return t.social.levelHigh;
    if (level === "medium") return t.social.levelMedium;
    return t.social.levelLow;
  };

  const analyze = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseInput(input);
    if (parsed.network === null && parsed.url) {
      setError(t.social.errNetwork);
      return;
    }
    const finalNetwork = parsed.network ?? network;
    const handle = parsed.handle.replace(/^@/, "");
    if (!handle || !HANDLE_PATTERNS[finalNetwork].test(handle)) {
      setError(t.social.errInvalid);
      return;
    }
    const followersNum = followers.trim() === "" ? null : Math.floor(Number(followers));
    const likesNum = likes.trim() === "" ? null : Math.floor(Number(likes));
    const commentsNum = comments.trim() === "" ? null : Math.floor(Number(comments));
    if (
      (followersNum !== null && (!Number.isFinite(followersNum) || followersNum < 0)) ||
      (likesNum !== null && (!Number.isFinite(likesNum) || likesNum < 0)) ||
      (commentsNum !== null && (!Number.isFinite(commentsNum) || commentsNum < 0))
    ) {
      setError(t.social.errInvalid);
      return;
    }
    const engagement =
      followersNum !== null && followersNum > 0 && (likesNum !== null || commentsNum !== null)
        ? round2(((likesNum ?? 0) + (commentsNum ?? 0)) / followersNum * 100)
        : null;
    const score = computeScore(followersNum, engagement, likesNum !== null || commentsNum !== null);
    const level = levelFor(score);
    const notesParts = [
      `${networkLabel(finalNetwork)} @${handle} · ${score}/100 (${levelLabel(level)})`,
      engagement !== null
        ? t.social.engagementUnit.replace("{valor}", engagement.toFixed(2))
        : t.social.engagementUnknown,
    ];
    const analysis: SocialAnalysis = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `social-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
      network: finalNetwork,
      handle,
      url: parsed.url || "",
      analyzedAt: new Date().toISOString(),
      followers: followersNum,
      engagement,
      score,
      level,
      notes: notesParts.join(" · "),
    };
    setResult(analysis);
    persist([analysis, ...saved]);
  };

  const removeSaved = (id: string) => {
    persist(saved.filter((a) => a.id !== id));
  };

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestions: string[] = [];
  if (result) {
    strengths.push(t.social.strengthHandleValid);
    if (result.engagement !== null && result.engagement >= 3) strengths.push(t.social.strengthEngagementHigh);
    if (result.followers !== null && result.followers >= 10000) strengths.push(t.social.strengthAudienceBig);
    if (result.followers !== null && result.engagement !== null) strengths.push(t.social.strengthDataComplete);
    if (result.engagement !== null && result.engagement < 1) {
      weaknesses.push(t.social.weaknessEngagementLow);
      suggestions.push(t.social.suggestionEngage);
    }
    if (result.followers !== null && result.followers < 1000) {
      weaknesses.push(t.social.weaknessAudienceSmall);
      suggestions.push(t.social.suggestionGrow);
    }
    if (result.followers === null || result.engagement === null) {
      weaknesses.push(t.social.weaknessNoMetrics);
      suggestions.push(t.social.suggestionAddMetrics);
    }
    if (
      result.engagement !== null &&
      result.followers !== null &&
      result.followers > 0
    ) {
      // Pocos comentarios frente a los me gusta: la conversación es baja.
      const likesNum = Number(likes);
      const commentsNum = Number(comments);
      if (Number.isFinite(likesNum) && Number.isFinite(commentsNum) && likesNum > 0 && commentsNum / likesNum < 0.02) {
        weaknesses.push(t.social.weaknessNoComments);
        suggestions.push(t.social.suggestionEngage);
      }
    }
    suggestions.push(t.social.suggestionConsistency);
  }

  return (
    <Panel
      title={t.social.panelTitle}
      badge={
        <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
          {t.social.badge}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">{t.social.intro}</p>
      <p role="note" className="mb-4 rounded-lg border border-sky-900/60 bg-sky-950/40 p-3 text-xs leading-relaxed text-sky-200/90">
        {t.social.noLive}
      </p>

      <form onSubmit={analyze} className="space-y-3">
        <input
          aria-label={t.social.urlAria}
          className={inputCls}
          placeholder={t.social.urlPlaceholder}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          required
          maxLength={2048}
          autoComplete="off"
          inputMode="url"
        />
        <div>
          <label htmlFor="social-network" className="mb-1 block text-xs font-medium text-zinc-300">
            {t.social.networkLabel}
          </label>
          <select
            id="social-network"
            className={inputCls}
            value={network}
            onChange={(e) => setNetwork(e.target.value as SocialNetwork)}
          >
            {NETWORKS.map((n) => (
              <option key={n} value={n}>
                {networkLabel(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="social-followers" className="mb-1 block text-xs font-medium text-zinc-300">
              {t.social.followersLabel}
            </label>
            <input
              id="social-followers"
              type="number"
              min={0}
              step={1}
              className={inputCls}
              value={followers}
              onChange={(e) => setFollowers(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
          </div>
          <div>
            <label htmlFor="social-likes" className="mb-1 block text-xs font-medium text-zinc-300">
              {t.social.likesLabel}
            </label>
            <input
              id="social-likes"
              type="number"
              min={0}
              step={1}
              className={inputCls}
              value={likes}
              onChange={(e) => setLikes(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
          </div>
          <div>
            <label htmlFor="social-comments" className="mb-1 block text-xs font-medium text-zinc-300">
              {t.social.commentsLabel}
            </label>
            <input
              id="social-comments"
              type="number"
              min={0}
              step={1}
              className={inputCls}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-zinc-500">{t.social.manualNote}</p>
        <button
          type="submit"
          disabled={!input.trim()}
          className="w-full rounded-lg bg-sky-600 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
        >
          {t.social.analyze}
        </button>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </form>

      {result && (
        <div className="mt-4 space-y-4 border-t border-zinc-800 pt-3">
          <div>
            <p className="text-lg font-semibold text-zinc-100">
              {networkLabel(result.network as SocialNetwork)} · @{result.handle}
            </p>
            {result.url && <p className="mt-1 break-all text-xs text-zinc-400">{result.url}</p>}
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${levelCls(result.level)}`}>
                {levelLabel(result.level)}
              </span>
              <span className="text-xs text-zinc-400">
                {t.social.scoreLine.replace("{puntaje}", String(result.score))}
              </span>
            </p>
            <p className="mt-2 text-sm text-zinc-200">
              <span className="font-semibold">{t.social.engagementLabel}: </span>
              {result.engagement !== null
                ? t.social.engagementUnit.replace("{valor}", result.engagement.toFixed(2))
                : t.social.engagementUnknown}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {result.followers !== null
                ? result.followers.toLocaleString()
                : t.social.followersUnknown}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-zinc-200">{t.social.strengthsTitle}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed text-zinc-400">
              {strengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-200">{t.social.weaknessesTitle}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed text-zinc-400">
              {weaknesses.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-200">{t.social.suggestionsTitle}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed text-zinc-400">
              {[...new Set(suggestions)].map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <p className="mb-2 text-sm font-semibold text-zinc-200">{t.social.savedTitle}</p>
        {saved.length === 0 ? (
          <EmptyState text={t.social.emptySaved} />
        ) : (
          <ul className="space-y-2">
            {saved.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-200">
                    {networkLabel(a.network as SocialNetwork)} · @{a.handle}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {a.score}/100 · {levelLabel(a.level)}
                    {a.engagement !== null
                      ? ` · ${t.social.engagementUnit.replace("{valor}", a.engagement.toFixed(2))}`
                      : ""}
                    {` · ${new Date(a.analyzedAt).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeSaved(a.id)}
                  className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
                >
                  {t.social.deleteBtn}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
