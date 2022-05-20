const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');
const stripe = require('stripe')("sk_test_51L1AeqHfb8VoLvD9wkDKJ6BbEPBkhJtUouDuHb6hPR1jbPBfVjA41sQaCjQAihLzlhjzm6tivmNJ2slGO68s6H7m00K7WEcjF5");
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kheml.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        await client.connect();

        const serviceCollection = client.db('doctors_portal').collection('services')
        const bookingCollection = client.db('doctors_portal').collection('booking')
        const userCollection = client.db('doctors_portal').collection('users')
        const doctorCollection = client.db('doctors_portal').collection('doctors')
        const paymentCollection = client.db('doctors_portal').collection('payments')


        const verifyJWT = (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'unAuthorized access' })
            }
            const token = authHeader.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
                if (err) {
                    console.log(err);
                    return res.status(403).send({ message: 'Forbidden access' })
                }
                req.decoded = decoded;
                next();
            });
        }

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === "admin") {
                next()
            }
            else {
                res.status(403).send({ message: 'forbidden access' })
            }
        }

        const EmailSenderOptions = {
            auth: {
                api_key: process.env.EMAIL_SENDER_KEY
            }
        }
        const EmailClient = nodemailer.createTransport(sgTransport(EmailSenderOptions));
        function sendAppointmentEmail(booking) {
            const { patient, patientName, treatment, date, slot } = booking
            var email = {
                from: process.env.EMAIL_SENDER,
                to: patient,
                subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirm`,
                text: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirm`,
                html: `
                <div>
                    <p> Hello ${patientName} </p>
                    <h3> Your Appointment for ${treatment} is confirm</h3>
                    <p> Looking forward to see you on ${date} at ${slot}</p>
                </div>
                `
            };

            EmailClient.sendMail(email, function (err, info) {
                if (err) {
                    console.log(err);
                }
                else {
                    console.log('Message sent: ', info);
                }
            });
        }
        function sendPaymentConfirmationEmail(booking) {
            const { patient, patientName, treatment, date, slot } = booking
            var email = {
                from: process.env.EMAIL_SENDER,
                to: patient,
                subject: `We have received your payment for ${treatment} is on ${date} at ${slot} is confirm`,
                text: `Your payment for this appointment ${treatment} is on ${date} at ${slot} is confirm`,
                html: `
                <div>
                    <p> Hello ${patientName} </p>
                    <h3> Thank you for your payment</h3>
                    <h3> We have received your payment</h3>
                    <p> Looking forward to see you on ${date} at ${slot}</p>
                </div>
                `
            };

            EmailClient.sendMail(email, function (err, info) {
                if (err) {
                    console.log(err);
                }
                else {
                    console.log('Message sent: ', info);
                }
            });
        }

        /* 
        * API naming convention
        * app.get('booking') // get all booking in this collection. or get mor than one or filter
        * app.get('/booking/:id') // get a specific booking
        * app.post('/booking') // add a new booking 
        * app.patch('/booking/:id') // update one booking
        * app.put('/booking/:id') // update (if exist) or insert (if doesn't exist)
        * app.delete('/booking/:id') // delete one booking
        */

        app.patch('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const payment = req.body
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId,

                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedDoc)
        })

        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({ clientSecret: paymentIntent.client_secret })
        })

        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users)
        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === "admin";
            res.send({ admin: isAdmin })
        })

        app.put("/user/admin/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester })
            if (requesterAccount.role === "admin") {
                const filter = { email: email }
                const updateDoc = {
                    $set: { role: 'admin' },
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
            }
            else {
                res.status(403).send({ message: 'forbidden' })
            }
        })

        app.put("/user/:email", async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email }
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "7d" })
            res.send({ result, token });
        })

        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings)
            }
            else {
                return res.status(403).send({ message: 'forbidden access' });
            }



        })

        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking)
        })

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exist = await bookingCollection.findOne(query)
            if (exist) {
                return res.send({ success: false, booking: exist })
            }
            const result = await bookingCollection.insertOne(booking);
            sendAppointmentEmail(booking)
            res.send({ success: true, result })
        })

        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 })
            const services = await cursor.toArray();
            res.send(services)
        })

        app.get('/available', async (req, res) => {
            const date = req.query.date;

            // step 1 = get all services
            const services = await serviceCollection.find().toArray();

            // step 2 = get the booking of the day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray()

            // step 3 = for each service, find bookings for that service
            services.forEach(service => {
                const serviceBookings = bookings.filter(book => book.treatment === service.name)
                const bookedSlots = serviceBookings.map(booking => booking.slot);
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                service.slots = available
                // service.booked = booked
            })

            res.send(services)

        });
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor)
            console.log(result);
            res.send(result)
        })

        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors)
        })

        app.delete('/doctor/:email', async (req, res) => {
            const email = req.params.email;
            const filter = { email: email }
            const result = await doctorCollection.deleteOne(filter)
            res.send(result)
        })


    }
    finally {

    }
}
run().catch(console.dir)

app.get('/', (req, res) => {
    res.send('hello from doctor server')
})

app.listen(port, () => {
    console.log(`doctors app listening on port ${port}`);
})