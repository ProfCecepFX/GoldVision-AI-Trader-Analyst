const SYSTEM_PROMPT = `
Kamu adalah GoldVision AI Trader Analyst, analis teknikal profesional.

TUGAS UTAMA:
Analisis screenshot chart forex/gold/crypto secara konservatif.
Jangan memaksakan sinyal.

PRINSIP:
1. PRIORITASKAN TIMEFRAME BESAR / HTF.
2. Cari struktur market: HH, HL, LH, LL, BOS, CHoCH.
3. Identifikasi support dan resistance yang jelas.
4. Cari supply/demand.
5. Cari liquidity sweep / rejection.
6. Perhatikan candle confirmation.
7. Perhatikan momentum dan trend.
8. Gunakan FVG/imbalance bila terlihat.
9. BUY idealnya dekat support/demand setelah ada konfirmasi.
10. SELL idealnya dekat resistance/supply setelah ada konfirmasi.
11. Jangan BUY hanya karena harga naik.
12. Jangan SELL hanya karena harga turun.
13. Jangan mengejar candle yang sudah berjalan jauh.
14. Hindari entry di tengah range.
15. Jika bukti belum cukup, WAJIB WAIT.
16. Entry hanya setelah setup terkonfirmasi.
17. Jangan mengubah entry/SL/TP setelah keputusan dibuat dalam satu analisis.
18. Jangan mengarang harga yang tidak terlihat pada chart.

FILTER SINYAL:
- Minimal 4 konfirmasi teknikal untuk BUY/SELL.
- Harus ada lokasi entry yang masuk akal.
- Harus ada invalidation level.
- Risk/reward minimal 1:2.
- Jika kondisi bertentangan, WAIT.
- Jika chart terlalu buram/tidak cukup informasi, WAIT.
- Confidence < 75 berarti WAIT.
- Confidence 75-84 = setup valid tetapi hati-hati.
- Confidence >=85 = setup kuat.

ATURAN BUY:
BUY hanya jika:
- harga berada dekat support/demand,
- struktur mendukung bullish,
- terdapat rejection/confirmation,
- momentum tidak menunjukkan bearish kuat,
- SL logis berada di bawah invalidation/support,
- TP memiliki RR minimal 1:2.

ATURAN SELL:
SELL hanya jika:
- harga berada dekat resistance/supply,
- struktur mendukung bearish,
- terdapat rejection/confirmation,
- momentum tidak menunjukkan bullish kuat,
- SL logis berada di atas invalidation/resistance,
- TP memiliki RR minimal 1:2.

NO-REPAINT:
Sinyal harus dianggap FIXED pada candle/chart yang dianalisis.
Jangan menggunakan informasi candle masa depan.
Jangan mengatakan sinyal pasti profit.

HASIL HARUS JSON VALID SAJA.
Jangan gunakan markdown.
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS
    // =========================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // =========================
    // HEALTH CHECK
    // =========================
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        ok: true,
        service: "GoldVision AI Trader Analyst",
        status: "online",
        endpoint: "/api/analyze"
      });
    }

    // =========================
    // ANALYZE SCREENSHOT
    // =========================
    if (url.pathname === "/api/analyze") {

      if (request.method !== "POST") {
        return json({
          ok: false,
          error: "Method harus POST"
        }, 405);
      }

      try {

        if (!env.OPENAI_API_KEY) {
          return json({
            ok: false,
            error: "OPENAI_API_KEY belum terpasang di Cloudflare Worker Secret."
          }, 500);
        }

        const body = await request.json();

        const image = body.image;
        const market = body.market || "XAUUSD";
        const timeframe = body.timeframe || "M5";

        if (!image) {
          return json({
            ok: false,
            error: "Screenshot/chart belum dikirim."
          }, 400);
        }

        // Validasi sederhana image
        if (
          typeof image !== "string" ||
          !image.startsWith("data:image/")
        ) {
          return json({
            ok: false,
            error: "Format gambar harus berupa data:image/... base64."
          }, 400);
        }

        const userPrompt = `
MARKET: ${market}
TIMEFRAME: ${timeframe}

Analisis screenshot chart berikut.

Periksa:
- HTF bias
- trend
- market structure
- support
- resistance
- supply
- demand
- liquidity
- BOS/CHoCH
- FVG/imbalance
- candle confirmation
- momentum
- lokasi entry
- invalidation
- SL
- TP1
- TP2
- TP3
- risk reward

Jangan membuat sinyal jika setup belum matang.

Jika belum ada setup:
signal = "WAIT"
entry = null
sl = null
tp1 = null
tp2 = null
tp3 = null

Jika setup valid:
signal = "BUY" atau "SELL"

Confidence harus angka 0-100.

Berikan alasan teknikal yang spesifik terhadap chart.
`;

        // =========================
        // OPENAI RESPONSES API
        // =========================
        const openaiResponse = await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: "gpt-5.6-luna",

              input: [
                {
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: SYSTEM_PROMPT
                    }
                  ]
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: userPrompt
                    },
                    {
                      type: "input_image",
                      image_url: image,
                      detail: "high"
                    }
                  ]
                }
              ],

              max_output_tokens: 1800
            })
          }
        );

        if (!openaiResponse.ok) {
          const errorText = await openaiResponse.text();

          return json({
            ok: false,
            error: "OpenAI API error",
            details: errorText
          }, openaiResponse.status);
        }

        const data = await openaiResponse.json();

        let output = data.output_text || "";

        // Fallback jika output_text tidak tersedia
        if (!output && Array.isArray(data.output)) {
          for (const item of data.output) {
            if (item.type === "message" && Array.isArray(item.content)) {
              for (const content of item.content) {
                if (content.type === "output_text") {
                  output += content.text || "";
                }
              }
            }
          }
        }

        if (!output) {
          return json({
            ok: false,
            error: "AI tidak mengembalikan hasil analisis.",
            raw: data
          }, 502);
        }

        // =========================
        // BERSIHKAN JSON
        // =========================
        output = output
          .replace(/```json/gi, "")
          .replace(/```/g, "")
          .trim();

        let result;

        try {
          result = JSON.parse(output);
        } catch (parseError) {

          // Coba ambil object JSON pertama
          const start = output.indexOf("{");
          const end = output.lastIndexOf("}");

          if (start !== -1 && end !== -1) {
            try {
              result = JSON.parse(
                output.substring(start, end + 1)
              );
            } catch (e) {
              return json({
                ok: false,
                error: "Format hasil AI tidak valid.",
                raw_output: output
              }, 502);
            }
          } else {
            return json({
              ok: false,
              error: "AI tidak menghasilkan JSON.",
              raw_output: output
            }, 502);
          }
        }

        // =========================
        // NORMALISASI HASIL
        // =========================
        const signal = String(
          result.signal || "WAIT"
        ).toUpperCase();

        const confidence = Number(
          result.confidence || 0
        );

        // Safety filter backend
        let finalSignal = signal;

        if (
          !["BUY", "SELL", "WAIT"].includes(signal)
        ) {
          finalSignal = "WAIT";
        }

        if (confidence < 75) {
          finalSignal = "WAIT";
        }

        if (finalSignal === "WAIT") {
          result.entry = null;
          result.sl = null;
          result.tp1 = null;
          result.tp2 = null;
          result.tp3 = null;
        }

        // =========================
        // RESPONSE STANDARD
        // =========================
        return json({
          ok: true,

          market: market,
          timeframe: timeframe,

          signal: finalSignal,

          confidence: confidence,

          setup: result.setup || "Tidak ada setup valid.",

          entry: result.entry ?? null,

          sl: result.sl ?? null,

          tp1: result.tp1 ?? null,
          tp2: result.tp2 ?? null,
          tp3: result.tp3 ?? null,

          rr: result.rr ?? null,

          trend: result.trend || "UNKNOWN",

          htfBias: result.htfBias || "UNKNOWN",

          support: result.support ?? null,

          resistance: result.resistance ?? null,

          supply: result.supply ?? null,

          demand: result.demand ?? null,

          structure: result.structure || "",

          confirmation: Array.isArray(result.confirmation)
            ? result.confirmation
            : [],

          reasons: Array.isArray(result.reasons)
            ? result.reasons
            : [],

          invalidation:
            result.invalidation ||
            "Setup batal jika struktur/invalidation ditembus.",

          riskWarning:
            result.riskWarning ||
            "Analisis teknikal bukan jaminan profit.",

          noRepaint: true,

          timestamp: new Date().toISOString()
        });

      } catch (error) {

        return json({
          ok: false,
          error: "Server analysis error",
          details: error?.message || String(error)
        }, 500);
      }
    }

    return json({
      ok: false,
      error: "Endpoint tidak ditemukan."
    }, 404);
  }
};


// =========================
// JSON RESPONSE
// =========================
function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=utf-8"
      }
    }
  );
}


// =========================
// CORS HEADERS
// =========================
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
