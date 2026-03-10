import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      name,
      email,
      phone,
      order_id,
      marketplace,
      reward,
      screenshot,
      code
    } = body;

    const SHOP = process.env.SHOPIFY_STORE;
    const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

    let screenshotUrl = "";

    // Upload screenshot to Cloudinary
    if (screenshot) {
      const upload = await cloudinary.uploader.upload(screenshot, {
        folder: "wellbi-reviews"
      });

      screenshotUrl = upload.secure_url;
    }

    const createdAt = new Date().toISOString();

    const query = `
      mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      metaobject: {
        type: "amazon_verification",
        fields: [
          { key: "name", value: name },
          { key: "email", value: email },
          { key: "phone", value: phone },
          { key: "order_id", value: order_id },
          { key: "marketplace", value: marketplace },
          { key: "reward", value: reward },
          { key: "screenshot", value: screenshotUrl },
          { key: "verification_code", value: code },
          { key: "status", value: "pending" },
          { key: "created_at", value: createdAt }
        ]
      }
    };

    const response = await fetch(
      `https://${SHOP}/admin/api/2024-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, variables })
      }
    );

    const data = await response.json();

    console.log(JSON.stringify(data, null, 2));

    return res.status(200).json(data);

  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }
}