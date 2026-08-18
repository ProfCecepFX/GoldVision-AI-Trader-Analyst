export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API: analisis screenshot chart
    if (url.pathname === "/api/analyze") {
      if (request.method !== "POST") {
        return json({ error: "Method harus POST" }, 405);
      }

      try {
        const body = await request.json();

        const image = body.image;
        const market = body.market || "XAUUSD";
        const timeframe = body.timeframe || "M5";

        if (!image) {
          return json({ error: "Screenshot belum dikirim" }, 400);
        }

        if (!env.OPENAI_API_KEY) {
          return json({
            error: "OPENAI_API_KEY belum dipasang di Cloudflare Worker."
          }, 500);
        }

        const response = await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: "gpt-5.6",
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: `
Kamu adalah GoldVision AI, analis teknikal untuk trader.

Analisis screenshot chart berikut.

Market: ${market}
Timeframe: ${timeframe}

Analisis:
1. Trend utama
2. Support dan resistance
3. Struktur market
4. Momentum
5. Kemungkinan BUY
6. Kemungkinan SELL
7. Area entry yang masuk akal
8. Stop loss
9. Take profit 1
10. Take profit 2
11. Take profit 3
12. Confidence

Jangan mengarang harga yang tidak terlihat pada chart.

Jika setup belum jelas, jawab WAIT.

Berikan hasil dalam JSON dengan format:

{
  "signal": "BUY | SELL | WAIT",
  "entry": "harga atau area",
  "stop_loss": "harga",
  "take_profit_1": "harga",
  "take_profit_2": "harga",
  "take_profit_3": "harga",
  "confidence": "0-100",
  "trend": "BULLISH | BEARISH | SIDEWAYS",
  "analysis": "penjelasan singkat",
  "warning": "risiko atau alasan menunggu"
}
                      `
                    },
                    {
                      type: "input_image",
                      image_url: image
                    }
                  ]
                }
              ]
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return json({
            error: "OpenAI API error",
            details: data
          }, response.status);
        }

        const text =
          data.output_text ||
          extractOutputText(data);

        let result;

        try {
          result = JSON.parse(text);
        } catch {
          result = {
            signal: "WAIT",
            entry: "-",
            stop_loss: "-",
            take_profit_1: "-",
            take_profit_2: "-",
            take_profit_3: "-",
            confidence: "0",
            trend: "UNKNOWN",
            analysis: text,
            warning: "Format analisis tidak dapat dibaca."
          };
        }

        return json(result);

      } catch (error) {
        return json({
          error: "Gagal menganalisis chart",
          details: String(error)
        }, 500);
      }
    }

    // Semua request selain API dikirim ke index.html
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("GoldVision AI", {
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
};

function extractOutputText(data) {
  try {
    return data.output
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n");
  } catch {
    return "";
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
