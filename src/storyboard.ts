import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import ffmpeg from "ffmpeg-static";
import { readArchive, writeArchive } from "./archive.js";
import {
  hash,
  loadMsb,
  referencedAssets,
  shotReferencePaths,
} from "./render.js";
import { msboOutputSchema, type MsboOutput } from "./schema.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const wrap = (value: string, width = 72) => {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (!last || last.length + word.length + 1 > width) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
  }
  return lines;
};
const srtTimestamp = (seconds: number) => {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};
const mime = (name: string) =>
  ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
  })[path.extname(name).toLowerCase()];

function panelSvg(
  shot: Awaited<ReturnType<typeof loadMsb>>["manifest"]["shots"][number],
  index: number,
  total: number,
  props: string[],
  timingAudioMode: "silence" | "system-voice",
  reference?: { name: string; bytes: Buffer },
): Buffer {
  const lines = [
    `SHOT ${index + 1}/${total}  ${shot.id}  ${shot.duration}s`,
    `CAST: ${shot.characters.join(", ") || "none"}`,
    `LOCATION: ${shot.location ?? "unspecified"}`,
    `PROPS: ${props.join(", ") || "none"}`,
    `ACTION: ${shot.action}`,
    `CAMERA: ${shot.camera}`,
    `CONTINUITY: ${shot.continuity.join("; ") || "none"}`,
    ...shot.dialogue.map(
      (d) =>
        `DIALOGUE ${d.start}-${d.end}s ${d.character ?? "ensemble"}: ${d.text}`,
    ),
    ...(shot.narration ? [`NARRATION: ${shot.narration}`] : []),
    `REFERENCES: ${shotReferencePaths(shot).join(", ") || "none"}`,
    timingAudioMode === "system-voice"
      ? "AUDIO: TEMPORARY LOCAL TIMING VOICES — NOT PRODUCTION AUDIO"
      : "AUDIO: TEMPORARY LOCAL TIMING SILENCE — NOT PRODUCTION AUDIO",
  ].flatMap((line) => wrap(line));
  const image = reference
    ? `<image x="40" y="90" width="560" height="630" preserveAspectRatio="xMidYMid meet" href="data:${mime(reference.name)};base64,${reference.bytes.toString("base64")}"/>`
    : `<rect x="40" y="90" width="560" height="630" fill="#202a3c"/><text x="320" y="405" text-anchor="middle" fill="#91a1b8" font-size="24">NO SHOT REFERENCE</text>`;
  const text = lines
    .map(
      (line, i) =>
        `<text x="640" y="${72 + i * 31}" fill="#f4f6fa" font-family="monospace" font-size="18">${escapeXml(line)}</text>`,
    )
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#111827"/><text x="40" y="52" fill="#65d6ad" font-family="monospace" font-size="26" font-weight="bold">LOCAL STORYBOARD</text>${image}${text}</svg>`,
  );
}

function contactSheet(
  shots: Awaited<ReturnType<typeof loadMsb>>["manifest"]["shots"],
): Buffer {
  const height = Math.max(320, shots.length * 270 + 80);
  const rows = shots
    .map((shot, index) => {
      const details = [
        `${shot.id} | ${shot.duration}s | ${shot.characters.join(", ") || "no cast"}`,
        `ACTION: ${shot.action}`,
        `CAMERA: ${shot.camera}`,
        `DIALOGUE: ${shot.dialogue.map((line) => `${line.start}-${line.end}s ${line.character ?? "ensemble"}`).join("; ") || "none"}`,
      ].flatMap((line) => wrap(line, 92));
      const y = 70 + index * 270;
      return `<rect x="24" y="${y}" width="1216" height="240" rx="12" fill="#111827" stroke="#334155"/><rect x="24" y="${y}" width="150" height="240" rx="12" fill="#17324d"/><text x="99" y="${y + 105}" text-anchor="middle" fill="#65d6ad" font-family="monospace" font-size="48" font-weight="bold">${index + 1}</text><text x="99" y="${y + 141}" text-anchor="middle" fill="#cbd5e1" font-family="monospace" font-size="18">SHOT</text>${details.map((line, lineIndex) => `<text x="198" y="${y + 38 + lineIndex * 29}" fill="#f4f6fa" font-family="monospace" font-size="18">${escapeXml(line)}</text>`).join("")}`;
    })
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${height}"><rect width="100%" height="100%" fill="#0b1020"/><text x="24" y="42" fill="white" font-family="monospace" font-size="26" font-weight="bold">LOCAL STORYBOARD CONTACT SHEET</text>${rows}</svg>`,
  );
}

export async function createStoryboard(
  source: string,
  outputFile: string,
  options: { timingVoices?: boolean } = {},
): Promise<void> {
  const ffmpegPath = ffmpeg as unknown as string | null;
  if (!ffmpegPath) throw new Error("bundled ffmpeg is unavailable");
  const loaded = await loadMsb(source);
  const work = await mkdtemp(path.join(tmpdir(), "msb-storyboard-"));
  try {
    const archive = new Map<string, Buffer>();
    const assetHashes = Object.fromEntries(
      referencedAssets(loaded.manifest)
        .sort()
        .map((name) => [name, hash(loaded.entries.get(name)!)]),
    );
    const shotRecords: MsboOutput["shots"] = [];
    const clips: string[] = [];
    const timingAudioMode = options.timingVoices ? "system-voice" : "silence";
    for (const [index, shot] of loaded.manifest.shots.entries()) {
      const referenceName =
        shotReferencePaths(shot)[0] ??
        loaded.manifest.locations.find((item) => item.id === shot.location)
          ?.reference ??
        loaded.manifest.characters.find((item) =>
          shot.characters.includes(item.id),
        )?.reference ??
        loaded.manifest.props.find((item) => item.reference)?.reference;
      const referenceBytes = referenceName
        ? loaded.entries.get(referenceName)
        : undefined;
      const panelPath = `storyboard/panels/${shot.id}.svg`;
      const panel = panelSvg(
        shot,
        index,
        loaded.manifest.shots.length,
        loaded.manifest.props.map((prop) => prop.id),
        timingAudioMode,
        referenceName && referenceBytes
          ? { name: referenceName, bytes: referenceBytes }
          : undefined,
      );
      archive.set(panelPath, panel);
      const audioPath = `storyboard/audio/${shot.id}.wav`;
      const audioFile = path.join(work, `${shot.id}.wav`);
      await createTimingAudio(
        shot,
        audioFile,
        ffmpegPath,
        work,
        options.timingVoices ?? false,
      );
      const audio = await readFile(audioFile);
      archive.set(audioPath, audio);
      const clip = path.join(work, `${shot.id}.mp4`);
      const reviewTextFile = path.join(work, `${shot.id}.srt`);
      const reviewText = [
        `LOCAL STORYBOARD | ${shot.id} | ${shot.duration}s`,
        `CAST: ${shot.characters.join(", ") || "none"}`,
        `LOCATION: ${shot.location ?? "unspecified"}`,
        `PROPS: ${loaded.manifest.props.map((prop) => prop.id).join(", ") || "none"}`,
        `ACTION: ${shot.action}`,
        `CAMERA: ${shot.camera}`,
        `CONTINUITY: ${shot.continuity.join("; ") || "none"}`,
        ...shot.dialogue.map(
          (line) =>
            `${line.start}-${line.end}s ${line.character ?? "ensemble"}: ${line.text}`,
        ),
        ...(shot.narration
          ? [`NARRATION 0-${shot.duration}s: ${shot.narration}`]
          : []),
        options.timingVoices
          ? "TEMPORARY TIMING VOICES — NOT PRODUCTION AUDIO"
          : "TEMPORARY TIMING SILENCE — NOT PRODUCTION AUDIO",
      ]
        .flatMap((line) => wrap(line, 52))
        .join("\n");
      await writeFile(
        reviewTextFile,
        `1\n00:00:00,000 --> ${srtTimestamp(shot.duration)}\n${reviewText}\n`,
      );
      const inputArgs =
        referenceName && referenceBytes && mime(referenceName)
          ? await (async () => {
              const ref = path.join(
                work,
                `${index}${path.extname(referenceName)}`,
              );
              await writeFile(ref, referenceBytes);
              return ["-loop", "1", "-i", ref];
            })()
          : ["-f", "lavfi", "-i", "color=c=0x202a3c:s=1280x720"];
      await execa(ffmpegPath, [
        "-y",
        ...inputArgs,
        "-i",
        audioFile,
        "-t",
        String(shot.duration),
        "-vf",
        `scale=600:720:force_original_aspect_ratio=decrease,pad=1280:720:0:(oh-ih)/2:color=0x111827,drawbox=x=600:y=0:w=680:h=720:color=0x111827:t=fill,subtitles='${reviewTextFile.replaceAll("'", "'\\''")}':force_style='FontName=DejaVu Sans,FontSize=18,PrimaryColour=&H00FFFFFF,Outline=0,Shadow=0,Alignment=7,MarginL=620,MarginR=20,MarginV=24'`,
        "-r",
        "24",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-map_metadata",
        "-1",
        "-shortest",
        clip,
      ]);
      clips.push(clip);
      shotRecords.push({
        id: shot.id,
        cacheKey: hash(JSON.stringify({ shot, assetHashes })),
        status: "complete",
        mediaPath: panelPath,
        mediaHash: hash(panel),
        panelPath,
        panelHash: hash(panel),
        timingAudioPath: audioPath,
        timingAudioHash: hash(audio),
        timeline: [
          ...shot.dialogue.map((line) => ({
            type: "dialogue" as const,
            ...line,
          })),
          ...(shot.narration
            ? [
                {
                  type: "narration" as const,
                  start: 0,
                  end: shot.duration,
                  text: shot.narration,
                },
              ]
            : []),
        ].sort((a, b) => a.start - b.start),
        provider: "local",
        model: "storyboard",
        estimatedCost: 0,
        actualCost: 0,
        attempts: 1,
        warnings: [
          options.timingVoices
            ? "timing audio uses temporary system voices, not production audio"
            : "timing audio is temporary silence, not production audio",
        ],
        completedAt: new Date().toISOString(),
      });
    }
    const list = path.join(work, "concat.txt");
    await writeFile(
      list,
      clips
        .map((clip) => `file '${clip.replaceAll("'", "'\\''")}'`)
        .join("\n") + "\n",
    );
    const movieFile = path.join(work, "storyboard.mp4");
    await execa(ffmpegPath, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-map_metadata",
      "-1",
      movieFile,
    ]);
    const movie = await readFile(movieFile);
    const moviePath = "storyboard/storyboard.mp4";
    archive.set(moviePath, movie);
    const sheetPath = "storyboard/contact-sheet.svg";
    const sheet = contactSheet(loaded.manifest.shots);
    archive.set(sheetPath, sheet);
    const now = new Date().toISOString();
    const creativeInputHash = hash(
      JSON.stringify({
        sourceHash: loaded.sourceHash,
        manifest: loaded.manifest,
        assetHashes,
      }),
    );
    const output: MsboOutput = {
      kind: "storyboard",
      formatVersion: "1.0.0",
      source: {
        hash: loaded.sourceHash,
        projectId: loaded.manifest.project.id,
        title: loaded.manifest.project.title,
      },
      configuration: { hash: hash("local-storyboard-v1") },
      tool: { name: "movie-source-builder", version: packageJson.version },
      settings: { width: 1280, height: 720, frameRate: 24 },
      status: "complete",
      createdAt: now,
      updatedAt: now,
      estimatedCost: 0,
      actualCost: 0,
      shots: shotRecords,
      warnings: [
        options.timingVoices
          ? "All timing audio uses temporary local system voices, not production audio."
          : "All timing audio is temporary local silence, not production audio.",
      ],
      storyboard: {
        duration: loaded.manifest.shots.reduce(
          (sum, shot) => sum + shot.duration,
          0,
        ),
        movie: moviePath,
        movieHash: hash(movie),
        contactSheet: sheetPath,
        contactSheetHash: hash(sheet),
        temporaryAudio: true,
        timingAudioMode,
        networkRequests: 0,
        assetHashes,
        creativeInputHash,
      },
    };
    archive.set(
      "source/msb.json",
      Buffer.from(`${JSON.stringify(loaded.manifest, null, 2)}\n`),
    );
    archive.set(
      "msbo.json",
      Buffer.from(`${JSON.stringify(output, null, 2)}\n`),
    );
    await writeArchive(archive, outputFile);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function createTimingAudio(
  shot: Awaited<ReturnType<typeof loadMsb>>["manifest"]["shots"][number],
  output: string,
  ffmpegPath: string,
  work: string,
  timingVoices: boolean,
): Promise<void> {
  const events = [
    ...shot.dialogue,
    ...(shot.narration
      ? [{ text: shot.narration, start: 0, end: shot.duration }]
      : []),
  ];
  if (!timingVoices || events.length === 0) {
    await execa(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=48000:cl=stereo:d=${shot.duration}`,
      "-map_metadata",
      "-1",
      output,
    ]);
    return;
  }
  const inputs = [
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=48000:cl=stereo:d=${shot.duration}`,
  ];
  const filters: string[] = [];
  for (const [index, event] of events.entries()) {
    const speech = path.join(work, `${shot.id}-voice-${index}.aiff`);
    const window = event.end - event.start;
    const words = event.text.trim().split(/\s+/).length;
    const rate = Math.max(
      140,
      Math.min(360, Math.ceil((words * 60 * 1.2) / window)),
    );
    try {
      await execa("say", ["-r", String(rate), "-o", speech, "--", event.text]);
    } catch (error) {
      throw new Error(
        `local timing voices require the macOS 'say' command: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    inputs.push("-i", speech);
    filters.push(
      `[${index + 1}:a]atrim=0:${window},adelay=${Math.round(event.start * 1000)}:all=1[v${index}]`,
    );
  }
  const mixed = ["[0:a]", ...events.map((_, index) => `[v${index}]`)].join("");
  filters.push(
    `${mixed}amix=inputs=${events.length + 1}:duration=first:normalize=0[a]`,
  );
  await execa(ffmpegPath, [
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[a]",
    "-t",
    String(shot.duration),
    "-c:a",
    "pcm_s16le",
    "-map_metadata",
    "-1",
    output,
  ]);
}

export async function approveStoryboard(
  file: string,
  source: string,
): Promise<void> {
  const entries = await readArchive(file);
  const raw = entries.get("msbo.json");
  if (!raw) throw new Error("msbo.json is required");
  const output = msboOutputSchema.parse(JSON.parse(raw.toString()));
  if (output.kind !== "storyboard" || !output.storyboard)
    throw new Error("approval requires a storyboard .msbo");
  const loaded = await loadMsb(source);
  if (loaded.sourceHash !== output.source.hash)
    throw new Error(
      "storyboard approval invalid: source or creative inputs changed",
    );
  const assetHashes = Object.fromEntries(
    referencedAssets(loaded.manifest)
      .sort()
      .map((name) => [name, hash(loaded.entries.get(name)!)]),
  );
  const creativeInputHash = hash(
    JSON.stringify({
      sourceHash: loaded.sourceHash,
      manifest: loaded.manifest,
      assetHashes,
    }),
  );
  if (creativeInputHash !== output.storyboard.creativeInputHash)
    throw new Error(
      "storyboard approval invalid: creative-input hash mismatch",
    );
  const expectedArtifacts = [
    [output.storyboard.movie, output.storyboard.movieHash],
    [output.storyboard.contactSheet, output.storyboard.contactSheetHash],
    ...output.shots.flatMap((shot) => [
      [shot.panelPath ?? shot.mediaPath, shot.panelHash ?? shot.mediaHash],
      [shot.timingAudioPath, shot.timingAudioHash],
    ]),
  ] as Array<[string | undefined, string | undefined]>;
  for (const [name, expectedHash] of expectedArtifacts) {
    const bytes = name ? entries.get(name) : undefined;
    if (!name || !expectedHash || !bytes || hash(bytes) !== expectedHash)
      throw new Error(
        `storyboard approval invalid: artifact hash mismatch: ${name ?? "missing path"}`,
      );
  }
  const artifactHash = hash(
    JSON.stringify({
      movie: output.storyboard.movieHash,
      contactSheet: output.storyboard.contactSheetHash,
      panels: output.shots.map((shot) => shot.mediaHash),
    }),
  );
  output.storyboard.approval = {
    approvedAt: new Date().toISOString(),
    creativeInputHash: output.storyboard.creativeInputHash,
    artifactHash,
  };
  output.updatedAt = output.storyboard.approval.approvedAt;
  entries.set("msbo.json", Buffer.from(`${JSON.stringify(output, null, 2)}\n`));
  await writeArchive(entries, file);
}
