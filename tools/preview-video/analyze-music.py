"""
Measures a music track's beat grid for the preview scenes: tempo, the first
downbeat, and a per-bar energy map (to find intros, drops and breakdowns).

    python3 tools/preview-video/analyze-music.py "Track.wav"

Only needs numpy + scipy (ffmpeg decodes the audio). Prints BPM, T0 (time of
bar 0's downbeat) and one line per bar with relative loudness and low-end
energy, which is what a scene's beat grid (`at(bar, beat)`) is built from.
"""
import subprocess
import sys

import numpy as np
from scipy.signal import find_peaks

SR = 22050
HOP = 256


def load(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def onset_envelope(y):
    """Spectral flux on a log-magnitude STFT: how much new energy arrives each hop."""
    n_fft = 2048
    win = np.hanning(n_fft)
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(y, (n_fft // 2, n_fft // 2)), n_fft)[::HOP]
    mag = np.log1p(np.abs(np.fft.rfft(frames * win, axis=1)))
    flux = np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux -= np.convolve(flux, np.ones(16) / 16, mode="same")  # remove slow trend
    return np.maximum(flux, 0)


def tempo(env, lo=70, hi=180):
    """Autocorrelation peak in the BPM range, refined to sub-hop precision."""
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    fps = SR / HOP
    lags = np.arange(len(ac))
    lo_lag, hi_lag = int(fps * 60 / hi), int(fps * 60 / lo)
    lag = lo_lag + np.argmax(ac[lo_lag:hi_lag])
    # parabolic refinement
    a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
    lag = lag + 0.5 * (a - c) / (a - 2 * b + c)
    bpm = 60 * fps / lag
    # prefer the 100–160 octave typical of pop/dance
    while bpm < 95:
        bpm *= 2
    while bpm > 170:
        bpm /= 2
    return bpm


def best_phase(env, bpm):
    """Offset (s) of the beat grid that lands on the most onset energy."""
    fps = SR / HOP
    period = 60 / bpm
    best, best_t = -1, 0
    for t0 in np.arange(0, period, 0.002):
        idx = ((t0 + np.arange(0, len(env) / fps - t0, period)) * fps).astype(int)
        idx = idx[idx < len(env)]
        score = env[idx].sum()
        if score > best:
            best, best_t = score, t0
    return best_t


def refine_bpm(env, bpm):
    """Fine search around the estimate: the tempo whose grid hits onsets hardest over the whole track."""
    fps = SR / HOP
    best = (-1, bpm, 0)
    for cand in np.arange(bpm - 0.6, bpm + 0.6, 0.01):
        t0 = best_phase(env, cand)
        period = 60 / cand
        idx = ((t0 + np.arange(0, len(env) / fps - t0, period)) * fps).astype(int)
        idx = idx[idx < len(env)]
        score = env[idx].sum()
        if score > best[0]:
            best = (score, cand, t0)
    return best[1], best[2]


def main():
    path = sys.argv[1]
    y = load(path)
    env = onset_envelope(y)
    bpm, phase = refine_bpm(env, tempo(env))
    beat = 60 / bpm
    bar = beat * 4
    dur = len(y) / SR

    # Which beat of four is the downbeat: the one with the most low-end onset energy.
    lows = []
    n_fft = 2048
    for k in range(4):
        total = 0
        for t in np.arange(phase + k * beat, dur, bar):
            i = int(t * SR)
            seg = y[i:i + n_fft]
            if len(seg) < n_fft:
                break
            spec = np.abs(np.fft.rfft(seg * np.hanning(n_fft)))
            total += spec[: int(150 * n_fft / SR)].sum()
        lows.append(total)
    t0 = phase + int(np.argmax(lows)) * beat
    while t0 - bar >= 0:
        t0 -= bar

    print(f"file      {path}")
    print(f"duration  {dur:.3f}s")
    print(f"BPM       {bpm:.3f}   (beat {beat:.4f}s, bar {bar:.4f}s)")
    print(f"T0        {t0:.3f}s  (bar 0 downbeat)")
    print()
    print("bar   time    loud   low   (relative to the loudest bar)")
    rms, low = [], []
    n_bars = int((dur - t0) / bar)
    for b in range(n_bars):
        s, e = int((t0 + b * bar) * SR), int((t0 + (b + 1) * bar) * SR)
        seg = y[s:e]
        rms.append(np.sqrt(np.mean(seg ** 2)))
        spec = np.abs(np.fft.rfft(seg))
        low.append(spec[: int(150 * len(seg) / SR)].sum() / len(seg))
    rms, low = np.array(rms), np.array(low)
    for b in range(n_bars):
        r, l = rms[b] / rms.max(), low[b] / low.max()
        print(f"{b:3d}  {t0 + b * bar:6.2f}s  {r:5.2f}  {l:5.2f}  {'#' * int(r * 30)}")


if __name__ == "__main__":
    main()
