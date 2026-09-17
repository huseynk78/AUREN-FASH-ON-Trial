# Trial Decision Note

During the trial, the following decisions were made where the brief left implementation details open:

* **Notification channel:** The brief requires customers to be notified when an order status changes but does not specify a channel. Email was selected using Gmail/Nodemailer because it could be implemented without adding an SMS or WhatsApp provider.
* **Order statuses:** The brief mentions `new, paid, shipped, delivered`. `confirmed`, `processing`, and `cancelled` were also added to represent the shop's operational workflow and required cancellation handling.
* **USD pricing:** Prices are calculated using an admin-configurable exchange rate. The initial rate is 1 USD = 1.70 AZN, matching the approximate rate mentioned in the brief.
* **Customer accounts:** Customer login, past orders, and one-click reorder were not implemented because they were explicitly listed as nice-to-have features and the trial was time-boxed to one week.
* **Admin organisation:** Orders are grouped into active, delivered, and cancelled sections to keep the admin workflow simple on a phone, while active orders retain their individual statuses.
* **Deployment email limitation:** Email notifications work in the local environment. On the deployed Render environment, Gmail SMTP connections currently time out, so this remains a deployment-specific limitation to address separately rather than changing the completed order workflow during the trial.
