import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* -----------------------------
 FIND CUSTOMER BY EMAIL
----------------------------- */

async function findCustomerByEmail(email, SHOP, TOKEN) {

  console.log("Checking if customer exists:", email);

  const query = `
  {
    customers(first: 1, query: "email:${email}") {
      edges {
        node {
          id
          email
        }
      }
    }
  }
  `;

  const response = await fetch(
    `https://${SHOP}/admin/api/2024-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    }
  );

  const data = await response.json();

  console.log("Customer search response:", JSON.stringify(data));

  return data?.data?.customers?.edges?.[0]?.node || null;
}


/* -----------------------------
 CREATE CUSTOMER
----------------------------- */

async function createCustomer(name, email, phone, marketplace, reward, SHOP, TOKEN) {

  console.log("Creating Shopify customer...");

  const [first, ...rest] = name.split(" ");
  const last = rest.join(" ");

  const tags = [
    marketplace === "amazon" ? "amazon-customer" : "myntra-customer",
    reward === "cashback" ? "reward-cashback" : "reward-voucher",
    "review-submitted"
  ];

  if (reward === "cashback") {
    tags.push("upi-cashback");
  }

  const mutation = `
  mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
  `;

  const variables = {
    input: {
      firstName: first || "",
      lastName: last || "",
      email,
      phone,
      tags
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
      body: JSON.stringify({ query: mutation, variables })
    }
  );

  const data = await response.json();

  console.log("Customer create response:", JSON.stringify(data));

  if (data?.data?.customerCreate?.userErrors?.length) {
    console.error("Customer create error:", data.data.customerCreate.userErrors);
  }

  return data?.data?.customerCreate?.customer?.id;
}


/* -----------------------------
 UPDATE MARKETPLACE METAFIELDS
----------------------------- */

async function updateMarketplaceMetafield(customerId, marketplace, SHOP, TOKEN) {

  console.log("Updating metafield for customer:", customerId);

  let metafields = [];

  if (marketplace === "amazon") {
    metafields.push({
      ownerId: customerId,
      namespace: "custom",
      key: "amazon_customer_N",
      type: "boolean",
      value: "true"
    });
  }

  if (marketplace === "myntra") {
    metafields.push({
      ownerId: customerId,
      namespace: "custom",
      key: "myntra_customer",
      type: "boolean",
      value: "true"
    });
  }

  const mutation = `
  mutation metafieldsSet($metafields:[MetafieldsSetInput!]!) {
    metafieldsSet(metafields:$metafields) {
      metafields { key namespace value }
      userErrors { field message }
    }
  }
  `;

  const response = await fetch(
    `https://${SHOP}/admin/api/2024-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: mutation,
        variables: { metafields }
      })
    }
  );

  const data = await response.json();

  console.log("Metafield update response:", JSON.stringify(data));
}


/* -----------------------------
 MAIN HANDLER
----------------------------- */

export default async function handler(req, res) {

  console.log("API CALLED");

  console.log("ENV CHECK");
  console.log("SHOP:", process.env.SHOPIFY_STORE);
  console.log("TOKEN EXISTS:", !!process.env.SHOPIFY_ADMIN_TOKEN);
  console.log("CLOUDINARY:", !!process.env.CLOUDINARY_CLOUD_NAME);

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

    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;

    console.log("Incoming request body:", body);

    const {
      name,
      email,
      phone,
      order_id,
      marketplace,
      reward,
      screenshot,
      upi
    } = body;

    const SHOP = process.env.SHOPIFY_STORE;
    const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

    let screenshotUrl = "";

    /* -----------------------------
     Upload screenshot to Cloudinary
    ----------------------------- */

    if (screenshot) {

      console.log("Uploading screenshot to Cloudinary");

      const upload = await cloudinary.uploader.upload(screenshot, {
        folder: "wellbi-reviews"
      });

      screenshotUrl = upload.secure_url;

      console.log("Screenshot uploaded:", screenshotUrl);

    }

    /* -----------------------------
     CUSTOMER LOGIC
    ----------------------------- */

    const existingCustomer = await findCustomerByEmail(email, SHOP, TOKEN);

    let customerId;

    if (existingCustomer) {

      console.log("Existing customer found:", existingCustomer.id);

      customerId = existingCustomer.id;

    } else {

      console.log("Creating new customer");

      customerId = await createCustomer(
        name,
        email,
        phone,
        marketplace,
        reward,
        SHOP,
        TOKEN
      );

      console.log("Customer created:", customerId);

    }

    /* -----------------------------
     UPDATE MARKETPLACE METAFIELD
    ----------------------------- */

    await updateMarketplaceMetafield(
      customerId,
      marketplace,
      SHOP,
      TOKEN
    );

    console.log("Metafield updated");

    /* -----------------------------
     CREATE METAOBJECT RECORD
    ----------------------------- */

    const createdAt = new Date().toISOString().split('.')[0] + "Z";

    const mutation = `
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
          { key: "name", value: String(name) },
          { key: "email", value: String(email) },
          { key: "phone", value: String(phone) },
          { key: "order_id", value: String(order_id) },
          { key: "marketplace", value: String(marketplace) },
          { key: "reward", value: String(reward) },
          { key: "upi_id", value: upi ? String(upi) : "" },
          { key: "screenshot", value: screenshotUrl },
          { key: "status", value: "pending" },
          { key: "created_at", value: createdAt }
        ]
      }
    };

    console.log("Creating metaobject...");

    const response = await fetch(
      `https://${SHOP}/admin/api/2024-01/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: mutation,
          variables
        })
      }
    );

    const data = await response.json();

    console.log("Metaobject response:", JSON.stringify(data));

    if (data?.data?.metaobjectCreate?.userErrors?.length) {

      console.error("Metaobject error:", data.data.metaobjectCreate.userErrors);

      return res.status(400).json({
        error: data.data.metaobjectCreate.userErrors
      });

    }

    console.log("Metaobject created successfully");

    return res.status(200).json({
      success: true,
      metaobjectId: data?.data?.metaobjectCreate?.metaobject?.id
    });

  } catch (error) {

    console.error("SERVER ERROR:", error);

    return res.status(500).json({
      error: error.message
    });

  }

}