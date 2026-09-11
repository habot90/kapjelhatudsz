"use client";
import { CITIES, COUNTRIES, DEFAULT_CITY_ID, cityCountry, getCity } from "./cities";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  createOrJoinRoom,
  getRoom,
  patchRoom,
  RoomApiError,
} from "./room-client";
import type {
  ConnectionState,
  PlayerRole,
  RoomPatchAction,
  RoomPlayer,
  RoomSession,
  RoomSnapshot,
} from "./types";
import styles from "./MultiplayerLobby.module.css";

const SESSION_KEY = "kapj-el-ha-tudsz.room-session.v1";
const NICKNAME_KEY = "kapj-el-ha-tudsz.nickname.v1";
const RUNNER_CAPACITY = 10;

type EntryMode = "create" | "join";
type PendingAction = "entry" | "role" | "ready" | "start" | "leave" | null;
type FieldErrors = { nickname?: string; code?: string };

export type MultiplayerLobbyProps = {
  onPractice: () => void;
  onEnterGame: (session: RoomSession, room: RoomSnapshot) => void;
};

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function isSavedSession(value: unknown): value is RoomSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RoomSession>;
  return (
    typeof candidate.roomCode === "string" &&
    normalizeRoomCode(candidate.roomCode).length === 6 &&
    typeof candidate.playerId === "string" &&
    candidate.playerId.length > 0 &&
    typeof candidate.token === "string" &&
    candidate.token.length > 0
  );
}

function loadSession(): RoomSession | null {
  try {
    const stored = window.localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isSavedSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveSession(session: RoomSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // A játék ettől még működik, csak egy oldalfrissítés után nem tud automatikusan visszalépni.
  }
}

function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // A memóriában tárolt munkamenet ettől még törölhető.
  }
}

function loadNickname(): string {
  try {
    return window.localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveNickname(nickname: string): void {
  try {
    window.localStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    // A becenév megjegyzése kényelmi funkció.
  }
}

function setRoomInAddress(code: string | null): void {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function isExpiredSessionError(error: unknown): boolean {
  return (
    error instanceof RoomApiError &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  );
}

function friendlyError(error: unknown): string {
  if (!(error instanceof RoomApiError)) {
    return "Váratlan hiba történt. Próbáld újra.";
  }

  const code = (error.code ?? "").toUpperCase();
  const knownMessages: Record<string, string> = {
    NETWORK_ERROR: "A játékszerver nem érhető el. Ellenőrizd a kapcsolatot, majd próbáld újra.",
    ROOM_NOT_FOUND: "Ez a szobakód nem létezik, vagy a szoba már bezárt.",
    ROOM_FULL: "A szoba megtelt: már van egy üldöző és tíz menekülő.",
    GAME_STARTED: "Ebben a szobában már elindult a hajsza.",
    NICKNAME_TAKEN: "Ezt a becenevet már használja valaki a szobában.",
    HUNTER_TAKEN: "Az üldözői helyet közben elfoglalta egy másik játékos.",
    RUNNER_SLOTS_FULL: "Mind a tíz menekülői hely foglalt.",
    NOT_HOST: "Csak a házigazda indíthatja el a hajszát.",
    NOT_READY: "A hajsza még nem indítható: nem áll mindenki készen.",
    INVALID_TOKEN: "A korábbi belépés lejárt. Csatlakozz újra a szobakóddal.",
    EMPTY_RESPONSE: "A játékszerver hibás választ küldött. Próbáld újra.",
  };

  if (knownMessages[code]) return knownMessages[code];
  if (error.status === 404) return knownMessages.ROOM_NOT_FOUND;
  if (error.status === 409) return "A szoba állapota közben megváltozott. Ellenőrizd a játékoslistát.";
  if (error.status >= 500) return "A játékszerver átmenetileg hibázik. Próbáld újra rövidesen.";
  return error.message || "A művelet nem sikerült.";
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy");
}

function connectionLabel(connection: ConnectionState): string {
  if (connection === "online") return "KAPCSOLÓDVA";
  if (connection === "connecting") return "KAPCSOLÓDÁS";
  if (connection === "reconnecting") return "ÚJRACSATLAKOZÁS";
  return "KAPCSOLAT NÉLKÜL";
}

function BrandHeader({ connection }: { connection?: ConnectionState }) {
  const stateClass = connection
    ? {
        online: styles.connectionOnline,
        connecting: styles.connectionConnecting,
        reconnecting: styles.connectionReconnecting,
        offline: styles.connectionOffline,
      }[connection]
    : "";

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">KE</span>
        <span className={styles.brandText}>
          <strong>KAPJ EL, HA TUDSZ!</strong>
          <small>ONLINE HAJSZA / MAGYARORSZÁG ÉS ROMÁNIA</small>
        </span>
      </div>
      {connection && (
        <span className={`${styles.connectionBadge} ${stateClass}`} aria-live="polite">
          <i aria-hidden="true" />
          {connectionLabel(connection)}
        </span>
      )}
    </header>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className={styles.shell}>
      <section className={styles.frame} aria-busy="true">
        <BrandHeader connection="connecting" />
        <div className={styles.loadingScreen} role="status">
          <span className={styles.scanner} aria-hidden="true" />
          <span className={styles.kicker}>NETWORK // SYNC</span>
          <h1>{label}</h1>
          <p>A műveleti csatorna ellenőrzése folyamatban.</p>
        </div>
      </section>
    </main>
  );
}

type EntryScreenProps = {
  cityId: string;
  onCityChange: (value: string) => void;
  mode: EntryMode;
  nickname: string;
  code: string;
  busy: boolean;
  errors: FieldErrors;
  requestError: string | null;
  notice: string | null;
  onModeChange: (mode: EntryMode) => void;
  onNicknameChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPractice: () => void;
};

function EntryScreen({
  cityId,
  onCityChange,
  mode,
  nickname,
  code,
  busy,
  errors,
  requestError,
  notice,
  onModeChange,
  onNicknameChange,
  onCodeChange,
  onSubmit,
  onPractice,
}: EntryScreenProps) {
  const nicknameHintId = useId();
  const nicknameErrorId = useId();
  const codeHintId = useId();
  const codeErrorId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <main className={styles.shell}>
      <section className={styles.frame}>
        <BrandHeader />
        <div className={styles.entryGrid}>
          <section className={styles.hero} aria-labelledby="lobby-title">
            <span className={styles.kicker}>MULTIPLAYER // BEVETÉS</span>
            <h1 id="lobby-title" ref={titleRef} tabIndex={-1}>
              A város a pálya.<br />A többiek valódiak.
            </h1>
            <p className={styles.lead}>
              Nyiss privát szobát, hívd meg a csapatot, majd válasszatok üldözőt és
              menekülőket. Regisztráció nem szükséges.
            </p>
            <div className={styles.facts} aria-label="Játékinformációk">
              <span><b>01</b><small>ÜLDÖZŐ</small></span>
              <span><b>10</b><small>MENEKÜLŐIG</small></span>
              <span><b>LIVE</b><small>SZINKRON</small></span>
            </div>
          </section>

          <section className={`${styles.panel} ${styles.entryPanel}`} aria-label="Belépés a játékba">
            <span className={styles.kicker}>HOZZÁFÉRÉS // SZOBA</span>
            <h2>{mode === "create" ? "Új hajsza indítása" : "Csatlakozás a csapathoz"}</h2>

            <div className={styles.tabList} role="group" aria-label="Belépési mód">
              <button
                type="button"
                className={mode === "create" ? styles.tabActive : ""}
                aria-pressed={mode === "create"}
                onClick={() => onModeChange("create")}
                disabled={busy}
              >
                SZOBÁT NYITOK
              </button>
              <button
                type="button"
                className={mode === "join" ? styles.tabActive : ""}
                aria-pressed={mode === "join"}
                onClick={() => onModeChange("join")}
                disabled={busy}
              >
                KÓDDAL BELÉPEK
              </button>
            </div>

            {notice && <div className={styles.notice} role="status">{notice}</div>}
            {requestError && <div className={styles.errorBanner} role="alert">{requestError}</div>}

            <form className={styles.form} onSubmit={onSubmit} noValidate>
              <label className={styles.field}>
                <span>Becenév</span>
                <input
                  className={errors.nickname ? styles.inputError : ""}
                  value={nickname}
                  onChange={(event) => onNicknameChange(event.target.value)}
                  autoComplete="nickname"
                  maxLength={20}
                  aria-invalid={Boolean(errors.nickname)}
                  aria-describedby={errors.nickname ? nicknameErrorId : nicknameHintId}
                  disabled={busy}
                />
                {errors.nickname ? (
                  <small id={nicknameErrorId} className={styles.fieldError}>{errors.nickname}</small>
                ) : (
                  <small id={nicknameHintId}>Ezen a néven látnak majd a többiek.</small>
                )}
              </label>

              {mode === "create" && (
                <label className={styles.field}>
                  <span>Ország</span>
                  <select className={styles.citySelect} value={cityCountry(cityId)} onChange={(event) => onCityChange(event.target.value === "hu" ? "budapest" : "bucharest")} disabled={busy}>
                    {COUNTRIES.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}
                  </select>
                </label>
              )}
              {mode === "create" && (
                <label className={styles.field}>
                  <span>Hol legyen a hajsza?</span>
                  <select className={styles.citySelect} value={cityId} onChange={(event) => onCityChange(event.target.value)} disabled={busy}>
                    {CITIES.filter((city) => cityCountry(city.id) === cityCountry(cityId)).map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
                  </select>
                  <small>Egy város, 8 zóna. Minden játékos itt indul. A gyakorló módhoz külön is választhatsz pályát.</small>
                </label>
              )}
              {mode === "join" && (
                <label className={styles.field}>
                  <span>Hatjegyű szobakód</span>
                  <input
                    className={`${styles.codeInput} ${errors.code ? styles.inputError : ""}`}
                    value={code}
                    onChange={(event) => onCodeChange(normalizeRoomCode(event.target.value))}
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={6}
                    aria-invalid={Boolean(errors.code)}
                    aria-describedby={errors.code ? codeErrorId : codeHintId}
                    disabled={busy}
                  />
                  {errors.code ? (
                    <small id={codeErrorId} className={styles.fieldError}>{errors.code}</small>
                  ) : (
                    <small id={codeHintId}>A meghívó tetején találod.</small>
                  )}
                </label>
              )}

              <button className={styles.primaryButton} type="submit" disabled={busy}>
                {busy && <span className={styles.buttonSpinner} aria-hidden="true" />}
                {busy
                  ? "KAPCSOLÓDÁS…"
                  : mode === "create"
                    ? "SZOBA LÉTREHOZÁSA"
                    : "BELÉPÉS A SZOBÁBA"}
              </button>
            </form>

            <div className={styles.divider}><span>VAGY</span></div>
            <button className={styles.practiceButton} type="button" onClick={onPractice} disabled={busy}>
              <span aria-hidden="true">⌖</span>
              <span><b>GYAKORLÓ HAJSZA</b><small>Játék egyedül, gépi menekülőkkel</small></span>
            </button>
          </section>
        </div>
      </section>
    </main>
  );
}

type InviteCardProps = {
  code: string;
  inviteUrl: string;
  copyStatus: string;
  nativeShareAvailable: boolean;
  onCopy: () => void;
  onShare: () => void;
};

function InviteCard({
  code,
  inviteUrl,
  copyStatus,
  nativeShareAvailable,
  onCopy,
  onShare,
}: InviteCardProps) {
  return (
    <section className={`${styles.panel} ${styles.inviteCard}`} aria-labelledby="invite-title">
      <div className={styles.panelHeading}>
        <span className={styles.kicker}>MEGHÍVÁS // PRIVÁT CSATORNA</span>
        <span className={styles.secureBadge}><i aria-hidden="true" />AKTÍV</span>
      </div>
      <h2 id="invite-title">Szobakód</h2>
      <output className={styles.roomCode} aria-label={`Szobakód: ${code}`}>{code}</output>
      <p>Küldd el a kódot vagy a meghívólinket a többi játékosnak.</p>
      <div className={styles.inviteActions}>
        <button className={styles.primaryButton} type="button" onClick={onCopy}>
          LINK MÁSOLÁSA
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onShare}>
          {nativeShareAvailable ? "MEGOSZTÁS" : "KÓD MÁSOLÁSA"}
        </button>
      </div>
      <span className={styles.srOnly}>{inviteUrl}</span>
      <div className={styles.copyStatus} aria-live="polite">{copyStatus}</div>
    </section>
  );
}

type RolePickerProps = {
  me: RoomPlayer;
  players: RoomPlayer[];
  disabled: boolean;
  onChange: (role: PlayerRole) => void;
};

function RolePicker({ me, players, disabled, onChange }: RolePickerProps) {
  const hunter = players.find((player) => player.role === "hunter");
  const runnerCount = players.filter((player) => player.role === "runner").length;
  const hunterUnavailable = Boolean(hunter && hunter.id !== me.id);
  const runnerUnavailable = runnerCount >= RUNNER_CAPACITY && me.role !== "runner";

  return (
    <fieldset className={`${styles.panel} ${styles.rolePanel}`} disabled={disabled}>
      <legend>Szereped a hajszában</legend>
      <p>A szerepváltás után újra jelezned kell, hogy készen állsz.</p>
      <div className={styles.roleGrid}>
        <label
          className={`${styles.roleCard} ${styles.hunterRole} ${me.role === "hunter" ? styles.roleSelected : ""} ${hunterUnavailable ? styles.roleDisabled : ""}`}
        >
          <input
            className={styles.srOnly}
            type="radio"
            name="room-role"
            value="hunter"
            checked={me.role === "hunter"}
            onChange={() => onChange("hunter")}
            disabled={disabled || hunterUnavailable}
          />
          <span className={styles.roleIcon} aria-hidden="true">⌖</span>
          <span><b>ÜLDÖZŐ</b><small>{hunterUnavailable ? `${hunter?.nickname} szerepe` : "1 szabad hely"}</small></span>
          <i aria-hidden="true" />
        </label>
        <label
          className={`${styles.roleCard} ${styles.runnerRole} ${me.role === "runner" ? styles.roleSelected : ""} ${runnerUnavailable ? styles.roleDisabled : ""}`}
        >
          <input
            className={styles.srOnly}
            type="radio"
            name="room-role"
            value="runner"
            checked={me.role === "runner"}
            onChange={() => onChange("runner")}
            disabled={disabled || runnerUnavailable}
          />
          <span className={styles.roleIcon} aria-hidden="true">➤</span>
          <span><b>MENEKÜLŐ</b><small>{runnerUnavailable ? "Minden hely foglalt" : `${runnerCount}/${RUNNER_CAPACITY} hely foglalt`}</small></span>
          <i aria-hidden="true" />
        </label>
      </div>
    </fieldset>
  );
}

function PlayerSlot({ player, playerRole }: { player?: RoomPlayer; playerRole: PlayerRole }) {
  if (!player) {
    return (
      <li className={`${styles.playerSlot} ${styles.emptySlot} ${playerRole === "hunter" ? styles.hunterSlot : styles.runnerSlot}`}>
        <span className={styles.slotIndex} aria-hidden="true">+</span>
        <span><b>Szabad hely</b><small>Meghívóra vár</small></span>
      </li>
    );
  }

  const playerStatus = !player.connected
    ? "Nincs kapcsolat"
    : player.ready
      ? "Készen áll"
      : "Készülődik";

  return (
    <li className={`${styles.playerSlot} ${playerRole === "hunter" ? styles.hunterSlot : styles.runnerSlot} ${!player.connected ? styles.disconnectedSlot : ""}`}>
      <span className={styles.playerGlyph} aria-hidden="true">{playerRole === "hunter" ? "⌖" : "➤"}</span>
      <span className={styles.playerIdentity}>
        <b>{player.nickname}</b>
        <small>
          {player.isHost && <em>HOST</em>}
          {playerStatus}
        </small>
      </span>
      <span className={`${styles.readyState} ${player.ready && player.connected ? styles.readyStateActive : ""}`}>
        <i aria-hidden="true" />{player.ready && player.connected ? "KÉSZ" : "VÁR"}
      </span>
    </li>
  );
}

function PlayerRoster({ players, meId }: { players: RoomPlayer[]; meId: string }) {
  const hunter = players.find((player) => player.role === "hunter");
  const runners = players.filter((player) => player.role === "runner").slice(0, RUNNER_CAPACITY);
  const runnerSlots = Array.from({ length: RUNNER_CAPACITY }, (_, index) => runners[index]);

  return (
    <section className={`${styles.panel} ${styles.rosterPanel}`} aria-labelledby="roster-title">
      <div className={styles.panelHeading}>
        <div>
          <span className={styles.kicker}>EGYSÉGEK // {players.length}/11</span>
          <h2 id="roster-title">Játékosok</h2>
        </div>
        <span className={styles.liveBadge}><i aria-hidden="true" />ÉLŐ</span>
      </div>

      <h3>Üldöző · 1 hely</h3>
      <ul className={styles.hunterList} aria-live="polite">
        <PlayerSlot player={hunter && { ...hunter, nickname: hunter.id === meId ? `${hunter.nickname} · TE` : hunter.nickname }} playerRole="hunter" />
      </ul>

      <h3>Menekülők · 10 hely</h3>
      <ul className={styles.runnerList} aria-live="polite">
        {runnerSlots.map((player, index) => (
          <PlayerSlot
            key={player?.id ?? `empty-${index}`}
            player={player && { ...player, nickname: player.id === meId ? `${player.nickname} · TE` : player.nickname }}
            playerRole="runner"
          />
        ))}
      </ul>
    </section>
  );
}

type LobbyScreenProps = {
  room: RoomSnapshot;
  connection: ConnectionState;
  pending: PendingAction;
  actionError: string | null;
  inviteUrl: string;
  copyStatus: string;
  nativeShareAvailable: boolean;
  onCopyInvite: () => void;
  onShareInvite: () => void;
  onRoleChange: (role: PlayerRole) => void;
  onReadyChange: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  onRetry: () => void;
};

function LobbyScreen({
  room,
  connection,
  pending,
  actionError,
  inviteUrl,
  copyStatus,
  nativeShareAvailable,
  onCopyInvite,
  onShareInvite,
  onRoleChange,
  onReadyChange,
  onStart,
  onLeave,
  onRetry,
}: LobbyScreenProps) {
  const me = room.players.find((player) => player.id === room.meId);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connected = connection === "online";

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  if (!me) {
    return (
      <main className={styles.shell}>
        <section className={styles.frame}>
          <BrandHeader connection={connection} />
          <div className={styles.terminalScreen} role="alert">
            <span className={styles.kicker}>SESSION // HIBA</span>
            <h1>A játékosod már nincs ebben a szobában.</h1>
            <button className={styles.secondaryButton} type="button" onClick={onLeave}>VISSZA A KEZDÉSHEZ</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <section className={styles.frame}>
        <BrandHeader connection={connection} />
        {(connection === "reconnecting" || connection === "offline") && (
          <div className={styles.reconnectBanner} role="status">
            <span className={styles.buttonSpinner} aria-hidden="true" />
            <span>
              <b>{connection === "offline" ? "A kapcsolat megszakadt" : "Újracsatlakozás folyamatban"}</b>
              <small>A helyedet megtartjuk, a műveletek átmenetileg szünetelnek.</small>
            </span>
            <button type="button" onClick={onRetry}>ÚJRAPRÓBÁLÁS</button>
          </div>
        )}

        <div className={styles.lobbyIntro}>
          <div>
            <span className={styles.kicker}>NETWORK // LOBBY</span>
            <h1 ref={titleRef} tabIndex={-1}>Műveleti váróterem</h1>
            <p>Helyszín: <strong>{getCity(room.cityId)?.name}</strong> · 8 zóna · 120 perc</p>
            <p>Válassz szerepet, jelezd, hogy készen állsz, és várd meg a rajtparancsot.</p>
          </div>
          <span className={styles.waitingBadge}><i aria-hidden="true" />RAJTRA VÁR</span>
        </div>

        {actionError && <div className={styles.errorBanner} role="alert">{actionError}</div>}

        <div className={styles.lobbyGrid} aria-busy={pending !== null}>
          <div className={styles.roomColumn}>
            <InviteCard
              code={room.code}
              inviteUrl={inviteUrl}
              copyStatus={copyStatus}
              nativeShareAvailable={nativeShareAvailable}
              onCopy={onCopyInvite}
              onShare={onShareInvite}
            />
            <RolePicker
              me={me}
              players={room.players}
              disabled={!connected || pending !== null || me.ready}
              onChange={onRoleChange}
            />
            <section className={`${styles.panel} ${styles.launchPanel}`}>
              <div className={styles.readyCopy}>
                <span className={styles.kicker}>SAJÁT ÁLLAPOT</span>
                <h2>{me.ready ? "Bevetésre kész" : "Még nem állsz készen"}</h2>
                <p>{me.ready ? "A szereped rögzítve. A rajtig még visszavonhatod." : "Ellenőrizd a szerepedet, majd erősítsd meg."}</p>
              </div>
              <button
                className={`${styles.readyButton} ${me.ready ? styles.readyButtonActive : ""}`}
                type="button"
                aria-pressed={me.ready}
                disabled={!connected || pending !== null}
                onClick={() => onReadyChange(!me.ready)}
              >
                {pending === "ready" && <span className={styles.buttonSpinner} aria-hidden="true" />}
                {me.ready ? "MÉGSEM ÁLLOK KÉSZEN" : "FELKÉSZÜLTEM"}
              </button>

              {me.isHost ? (
                <div className={styles.hostControls}>
                  <button
                    className={styles.startButton}
                    type="button"
                    disabled={!connected || pending !== null || !room.canStart}
                    onClick={onStart}
                  >
                    {pending === "start" && <span className={styles.buttonSpinner} aria-hidden="true" />}
                    HAJSZA INDÍTÁSA
                  </button>
                  <p>{room.canStart ? "Minden egység készen áll." : room.startBlocker ?? "Legalább egy üldöző és egy menekülő szükséges."}</p>
                </div>
              ) : (
                <p className={styles.hostWaiting}>A hajszát a házigazda indítja, amikor mindenki készen áll.</p>
              )}

              <button className={styles.leaveButton} type="button" disabled={pending !== null} onClick={onLeave}>
                {pending === "leave" ? "KILÉPÉS…" : "KILÉPÉS A SZOBÁBÓL"}
              </button>
            </section>
          </div>

          <div className={styles.rosterColumn}>
            <PlayerRoster players={room.players} meId={room.meId} />
          </div>
        </div>
      </section>
    </main>
  );
}

type SynchronizedStartProps = {
  room: RoomSnapshot;
  session: RoomSession;
  connection: ConnectionState;
  onEnterGame: (session: RoomSession, room: RoomSnapshot) => void;
  onLeave: () => void;
  onRetry: () => void;
};

function SynchronizedStart({ room, session, connection, onEnterGame, onLeave, onRetry }: SynchronizedStartProps) {
  const me = room.players.find((player) => player.id === room.meId);
  const roleName = me?.role === "hunter" ? "ÜLDÖZŐ" : "MENEKÜLŐ";
  const roleBrief = me?.role === "hunter"
    ? "Találd meg és fogd el a menekülőket."
    : "Maradj mozgásban, használd okosan a jelzések közti időt.";

  return (
    <main className={styles.shell}>
      <section className={styles.frame}>
        <BrandHeader connection={connection} />
        <div className={styles.startScreen}>
          <div className={`${styles.startGlyph} ${me?.role === "hunter" ? styles.startGlyphHunter : styles.startGlyphRunner}`} aria-hidden="true">
            {me?.role === "hunter" ? "⌖" : "➤"}
          </div>
          <span className={styles.kicker}>ROOM {room.code} · SYNCHRONIZED</span>
          <h1>A rajtjel megérkezett.</h1>
          <p>Minden játékos ugyanarra a közös térképre lép. A saját autódat irányítod, az ellenfelet pedig csak a játékszabályok szerinti jelzések fedik fel.</p>
          <div className={styles.briefingCard}>
            <span>KIOSZTOTT SZEREP</span>
            <strong>{roleName}</strong>
            <small>{roleBrief}</small>
          </div>
          {connection !== "online" && (
            <div className={styles.startWarning} role="status">
              A belépéshez helyre kell állnia a kapcsolatnak.
              <button type="button" onClick={onRetry}>ÚJRAPRÓBÁLÁS</button>
            </div>
          )}
          <button
            className={styles.enterGameButton}
            type="button"
            disabled={!me || connection !== "online"}
            onClick={() => onEnterGame(session, room)}
          >
            BELÉPEK A KÖZÖS TÉRKÉPRE
          </button>
          <button className={styles.leaveButton} type="button" onClick={onLeave}>KILÉPÉS A SZOBÁBÓL</button>
        </div>
      </section>
    </main>
  );
}

function FinishedScreen({ room, onLeave, onPractice }: { room: RoomSnapshot; onLeave: () => void; onPractice: () => void }) {
  return (
    <main className={styles.shell}>
      <section className={styles.frame}>
        <BrandHeader connection="online" />
        <div className={styles.terminalScreen}>
          <span className={styles.kicker}>ROOM {room.code} · LEZÁRVA</span>
          <h1>Ez a hajsza véget ért.</h1>
          <p>Nyiss új szobát, vagy próbáld ki ismét a gyakorló módot.</p>
          <div className={styles.terminalActions}>
            <button className={styles.primaryButton} type="button" onClick={onLeave}>ÚJ ONLINE SZOBA</button>
            <button className={styles.secondaryButton} type="button" onClick={onPractice}>GYAKORLÁS</button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function MultiplayerLobby({ onPractice, onEnterGame }: MultiplayerLobbyProps) {
  const [booting, setBooting] = useState(true);
  const [mode, setMode] = useState<EntryMode>("create");
  const [cityId, setCityId] = useState<string>(DEFAULT_CITY_ID);
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [entryError, setEntryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSessionState] = useState<RoomSession | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [pending, setPending] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const mountedRef = useRef(true);

  const acceptRoom = useCallback((nextRoom: RoomSnapshot) => {
    setRoom((currentRoom) => {
      if (!currentRoom) return nextRoom;
      if (nextRoom.revision !== currentRoom.revision) {
        return nextRoom.revision > currentRoom.revision ? nextRoom : currentRoom;
      }
      return Date.parse(nextRoom.serverNow) >= Date.parse(currentRoom.serverNow)
        ? nextRoom
        : currentRoom;
    });
  }, []);

  const forgetRoom = useCallback((message?: string) => {
    clearSession();
    setRoomInAddress(null);
    setSessionState(null);
    setRoom(null);
    setConnection("connecting");
    setPending(null);
    setActionError(null);
    setMode("create");
    setCode("");
    setNotice(message ?? null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => {
      if (!mountedRef.current) return;
      const params = new URLSearchParams(window.location.search);
      const invitedCode = normalizeRoomCode(params.get("room") ?? "");
      const storedSession = loadSession();

      setNickname(loadNickname());
      if (invitedCode) {
        setMode("join");
        setCode(invitedCode);
      }

      if (storedSession && (!invitedCode || storedSession.roomCode === invitedCode)) {
        setSessionState(storedSession);
        setConnection("connecting");
      }

      setBooting(false);
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let lastHeartbeat = 0;

    const schedule = (delay: number) => {
      timer = setTimeout(poll, delay);
    };

    const poll = async () => {
      controller = new AbortController();
      try {
        const shouldHeartbeat = Date.now() - lastHeartbeat >= 8_000;
        const nextRoom = shouldHeartbeat
          ? await patchRoom(session, { action: "heartbeat" }, controller.signal)
          : await getRoom(session, controller.signal);
        if (stopped) return;
        if (shouldHeartbeat) lastHeartbeat = Date.now();
        failures = 0;
        acceptRoom(nextRoom);
        setConnection("online");
        schedule(2_000);
      } catch (error) {
        if (stopped) return;
        if (isExpiredSessionError(error)) {
          forgetRoom("A korábbi belépés lejárt. Add meg újra a szobakódot.");
          return;
        }
        failures += 1;
        setConnection(failures >= 3 ? "offline" : "reconnecting");
        const delay = Math.min(15_000, 1_000 * 2 ** Math.min(failures - 1, 4));
        schedule(delay);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [acceptRoom, forgetRoom, reconnectKey, session]);

  const inviteUrl = useMemo(() => {
    if (!room || typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.searchParams.set("room", room.code);
    return url.toString();
  }, [room]);

  const nativeShareAvailable =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleModeChange = (nextMode: EntryMode) => {
    setMode(nextMode);
    setEntryError(null);
    setFieldErrors({});
    setNotice(null);
  };

  const handleEntrySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const cleanNickname = nickname.trim();
    const cleanCode = normalizeRoomCode(code);
    const errors: FieldErrors = {};
    if (cleanNickname.length < 2 || cleanNickname.length > 20) {
      errors.nickname = "A becenév 2–20 karakter hosszú legyen.";
    }
    if (mode === "join" && cleanCode.length !== 6) {
      errors.code = "Pontosan 6 betűből vagy számból álló kód szükséges.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setEntryError(null);
      return;
    }

    setFieldErrors({});
    setEntryError(null);
    setNotice(null);
    setPending("entry");
    try {
      const response = await createOrJoinRoom({
        action: mode,
        ...(mode === "create" ? { cityId } : {}),
        nickname: cleanNickname,
        ...(mode === "join" ? { code: cleanCode } : {}),
        role: mode === "create" ? "hunter" : "runner",
      });
      if (!mountedRef.current) return;
      saveNickname(cleanNickname);
      saveSession(response.session);
      setRoomInAddress(response.room.code);
      setSessionState(response.session);
      acceptRoom(response.room);
      setConnection("online");
      setActionError(null);
    } catch (error) {
      if (mountedRef.current) setEntryError(friendlyError(error));
    } finally {
      if (mountedRef.current) setPending(null);
    }
  };

  const runAction = async (actionName: Exclude<PendingAction, "entry" | null>, action: RoomPatchAction) => {
    if (!session || pending) return null;
    setPending(actionName);
    setActionError(null);
    try {
      const nextRoom = await patchRoom(session, action);
      if (mountedRef.current) {
        acceptRoom(nextRoom);
        setConnection("online");
      }
      return nextRoom;
    } catch (error) {
      if (mountedRef.current) {
        if (isExpiredSessionError(error)) {
          forgetRoom("A belépésed lejárt. Csatlakozz újra a szobához.");
        } else {
          setActionError(friendlyError(error));
        }
      }
      return null;
    } finally {
      if (mountedRef.current) setPending(null);
    }
  };

  const handleLeave = async () => {
    if (!session) {
      forgetRoom();
      return;
    }
    const result = await runAction("leave", { action: "leave" });
    if (result && mountedRef.current) forgetRoom();
  };

  const handleCopyInvite = async () => {
    try {
      await copyToClipboard(inviteUrl);
      setCopyStatus("Meghívólink másolva.");
    } catch {
      setCopyStatus("A linket nem sikerült másolni.");
    }
  };

  const handleShareInvite = async () => {
    if (!room) return;
    if (nativeShareAvailable) {
      try {
        await navigator.share({
          title: "Kapj el, ha tudsz!",
          text: `Csatlakozz a ${room.code} kódú hajszához!`,
          url: inviteUrl,
        });
        setCopyStatus("Meghívó megosztva.");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCopyStatus("A megosztás nem sikerült.");
      }
      return;
    }

    try {
      await copyToClipboard(room.code);
      setCopyStatus("Szobakód másolva.");
    } catch {
      setCopyStatus("A kódot nem sikerült másolni.");
    }
  };

  if (booting) return <LoadingScreen label="Belépési pont előkészítése…" />;

  if (!session) {
    return (
      <EntryScreen
        cityId={cityId}
        onCityChange={setCityId}
        mode={mode}
        nickname={nickname}
        code={code}
        busy={pending === "entry"}
        errors={fieldErrors}
        requestError={entryError}
        notice={notice}
        onModeChange={handleModeChange}
        onNicknameChange={(value) => {
          setNickname(value);
          setFieldErrors((current) => ({ ...current, nickname: undefined }));
        }}
        onCodeChange={(value) => {
          setCode(value);
          setFieldErrors((current) => ({ ...current, code: undefined }));
        }}
        onSubmit={handleEntrySubmit}
        onPractice={onPractice}
      />
    );
  }

  if (!room) return <LoadingScreen label="Visszatérés a szobába…" />;

  if (room.status === "playing") {
    return (
      <SynchronizedStart
        room={room}
        session={session}
        connection={connection}
        onEnterGame={onEnterGame}
        onLeave={handleLeave}
        onRetry={() => {
          setConnection("connecting");
          setReconnectKey((value) => value + 1);
        }}
      />
    );
  }

  if (room.status === "finished") {
    return <FinishedScreen room={room} onLeave={handleLeave} onPractice={onPractice} />;
  }

  return (
    <LobbyScreen
      room={room}
      connection={connection}
      pending={pending}
      actionError={actionError}
      inviteUrl={inviteUrl}
      copyStatus={copyStatus}
      nativeShareAvailable={nativeShareAvailable}
      onCopyInvite={handleCopyInvite}
      onShareInvite={handleShareInvite}
      onRoleChange={(role) => void runAction("role", { action: "role", role })}
      onReadyChange={(ready) => void runAction("ready", { action: "ready", ready })}
      onStart={() => void runAction("start", { action: "start" })}
      onLeave={() => void handleLeave()}
      onRetry={() => {
        setConnection("connecting");
        setReconnectKey((value) => value + 1);
      }}
    />
  );
}

