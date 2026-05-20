import assert from "node:assert/strict";
import test from "node:test";

import { YouTubeTranscriptFetcher, YouTubeUtils } from "../dist/youtube.js";

test("extractVideoId handles common YouTube URL variants", () => {
  assert.equal(YouTubeTranscriptFetcher.extractVideoId("AJpK3YTTKZ4"), "AJpK3YTTKZ4");
  assert.equal(YouTubeTranscriptFetcher.extractVideoId("https://www.youtube.com/watch?v=AJpK3YTTKZ4&t=12"), "AJpK3YTTKZ4");
  assert.equal(YouTubeTranscriptFetcher.extractVideoId("https://youtu.be/AJpK3YTTKZ4?si=test"), "AJpK3YTTKZ4");
  assert.equal(YouTubeTranscriptFetcher.extractVideoId("https://www.youtube.com/shorts/AJpK3YTTKZ4"), "AJpK3YTTKZ4");
  assert.equal(YouTubeTranscriptFetcher.extractVideoId("https://www.youtube.com/live/AJpK3YTTKZ4?feature=share"), "AJpK3YTTKZ4");
});

test("parseTranscriptBody parses YouTube srv3 XML", () => {
  const xml = `<?xml version="1.0" encoding="utf-8" ?><timedtext><body>
    <p t="0" d="2669">Should we be doing like big smile or?</p>
    <p t="2669" d="2044">- No, what you&#39;re doing-<br />- Big smile&#39;s creepy.</p>
  </body></timedtext>`;

  const transcripts = YouTubeUtils.parseTranscriptBody(xml, "en");

  assert.equal(transcripts.length, 2);
  assert.equal(transcripts[0].timestamp, 0);
  assert.equal(transcripts[0].duration, 2.669);
  assert.equal(transcripts[1].text, "- No, what you're doing- - Big smile's creepy.");
});

test("parseTranscriptBody parses classic XML", () => {
  const xml = `<transcript>
    <text start="1.5" dur="2.25">Hello &amp; welcome</text>
  </transcript>`;

  const transcripts = YouTubeUtils.parseTranscriptBody(xml, "en");

  assert.deepEqual(transcripts, [{
    text: "Hello & welcome",
    lang: "en",
    timestamp: 1.5,
    duration: 2.25
  }]);
});

test("parseTranscriptBody parses json3", () => {
  const json = JSON.stringify({
    events: [
      {
        tStartMs: 1000,
        dDurationMs: 2500,
        segs: [{ utf8: "Hello" }, { utf8: " " }, { utf8: "world" }]
      }
    ]
  });

  const transcripts = YouTubeUtils.parseTranscriptBody(json, "en");

  assert.deepEqual(transcripts, [{
    text: "Hello world",
    lang: "en",
    timestamp: 1,
    duration: 2.5
  }]);
});

test("parseTranscriptBody parses VTT", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello <b>world</b>
`;

  const transcripts = YouTubeUtils.parseTranscriptBody(vtt, "en");

  assert.deepEqual(transcripts, [{
    text: "Hello world",
    lang: "en",
    timestamp: 1,
    duration: 2.5
  }]);
});

test("formatTimedTranscriptText formats timestamped lines", () => {
  const text = YouTubeUtils.formatTimedTranscriptText([
    {
      text: "Hello &amp; welcome",
      lang: "en",
      timestamp: 1.25,
      duration: 2
    },
    {
      text: "next line",
      lang: "en",
      timestamp: 65,
      duration: 1
    }
  ]);

  assert.equal(text, "[00:00:01.250] Hello & welcome\n[00:01:05.000] next line");
});
