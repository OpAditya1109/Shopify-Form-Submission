export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { name, email, phone, order_id, code } = body;

    const SHOP = process.env.SHOPIFY_STORE;
    const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

    const response = await fetch(
      `https://${SHOP}/admin/api/2024-01/metaobjects.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metaobject: {
            type: "amazon_verification",
            fields: [
              { key: "name", value: name },
              { key: "email", value: email },
              { key: "phone", value: phone },
              { key: "order_id", value: order_id },
              { key: "code", value: code }
            ]
          }
        })
      }
    );

    const data = await response.json();

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}